import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import {
  readPackage,
  writePackage,
  listTextBoxes,
  insertTextBox,
  setTextBoxGeometry,
  removeTextBox,
  makeFloatingTransparent,
  nextDocPrId,
  uniqueSdtId,
  DOCX_MIME,
} from './docx-textboxes.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), add: $('add-textbox'), open: $('open-file'), download: $('download'), editor: $('editor'),
  panelEmpty: $('panel-empty'), form: $('panel-form'), select: $('box-select'), info: $('box-info'),
  value: $('sdt-value'), x: $('tb-x'), y: $('tb-y'), w: $('tb-w'), h: $('tb-h'), sdtSize: $('sdt-size'),
  remove: $('remove-textbox'), refresh: $('refresh'), transparent: $('make-transparent'),
};

const DEFAULT_BOX = { w: 180, h: 36, value: 'SDT (inside floating text box)', alias: 'Text box SDT' };
const PX_PER_PT = 96 / 72;
const BLOCK_TYPES_FOR_ANCHOR = new Set(['paragraph', 'heading', 'listItem']);

const state = { boxes: [], metrics: null, selectedKey: null, busy: false };

/**
 * The sample document. A static host that cannot serve .docx files (the claude.ai Artifact
 * build) embeds it as base64 in `window.__SAMPLE_DOCX_B64`; otherwise fetch it by URL.
 */
function initialDocument() {
  const b64 = window.__SAMPLE_DOCX_B64;
  if (typeof b64 === 'string' && b64.length) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new File([bytes], 'sample.docx', { type: DOCX_MIME });
  }
  return new URL('sample.docx', document.baseURI).href;
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: initialDocument(),
  documentMode: 'editing',
  user: { name: 'Local user', email: 'local@example.com' },
  onReady: () => {
    setStatus('ready');
    els.add.disabled = false;
    els.download.disabled = false;
    if (!state.busy) refreshBoxes().catch(reportError);
  },
  onContentError: ({ error }) => { setStatus('content error'); console.error(error); },
  onException: (e) => console.error(e),
});
window.superdoc = superdoc; // handy for poking at the API from the console

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const fmt = (n) => Math.round(Number(n) * 10) / 10;
const num = (el) => Number(el.value);
const setStatus = (text) => { els.status.textContent = text; };
const reportError = (e) => { console.error(e); setStatus('error: ' + (e?.message || e)); };
const zoomScale = () => (superdoc.ui.zoom.getSnapshot().value || 100) / 100;
const docApi = () => superdoc.activeEditor?.doc ?? null;
const selectedBox = () => state.boxes.find((b) => b.key === state.selectedKey) ?? null;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBusy(label, fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  els.add.disabled = true;
  setStatus(label);
  try {
    await fn();
    setStatus('ready');
  } catch (e) {
    reportError(e);
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
    els.add.disabled = false;
  }
}

async function exportPackage() {
  const blob = await superdoc.activeEditor.exportDocx();
  return readPackage(blob);
}

async function loadPackage(files, doc) {
  await superdoc.replaceFile(writePackage(files, doc));
}

/** Poll the Document API until a content control with this id is listed (the reload is asynchronous). */
async function waitForSdt(sdtId, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await docApi()?.contentControls.list();
      if (res?.items?.some((i) => i.id === sdtId)) return true;
    } catch { /* not ready yet */ }
    await sleep(150);
  }
  return false;
}

async function waitForDocumentApi(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { await docApi()?.contentControls.list(); return; } catch { await sleep(150); }
  }
}

// ---------------------------------------------------------------------------
// Which page is in view, and which paragraph to anchor to
// ---------------------------------------------------------------------------

/** The rendered page under the vertical middle of the editor viewport (or the most visible one). */
function pageInView() {
  const host = els.editor.getBoundingClientRect();
  const midY = host.top + host.height / 2;
  let best = null;
  for (const el of els.editor.querySelectorAll('.superdoc-page')) {
    const r = el.getBoundingClientRect();
    const index = Number(el.dataset.pageIndex ?? Number(el.dataset.pageNumber) - 1);
    if (Number.isNaN(index)) continue;
    if (r.top <= midY && r.bottom >= midY) return { index, el };
    const visible = Math.max(0, Math.min(r.bottom, host.bottom) - Math.max(r.top, host.top));
    if (!best || visible > best.visible) best = { index, el, visible };
  }
  return best;
}

async function listAllBlocks() {
  const doc = docApi();
  const blocks = [];
  let offset = 0;
  for (;;) {
    const res = await doc.blocks.list({ offset, limit: 200 });
    const page = res?.blocks ?? [];
    blocks.push(...page);
    if (!page.length || blocks.length >= (res.total ?? blocks.length)) break;
    offset += page.length;
  }
  return blocks;
}

const blockStartTarget = (blockId) => ({
  kind: 'selection',
  start: { kind: 'text', blockId, offset: 0 },
  end: { kind: 'text', blockId, offset: 0 },
});

/** First body paragraph whose painted geometry lands on the given page. Rect is relative to the page element. */
async function firstBlockOnPage(pageIndex, pageEl) {
  for (const block of await listAllBlocks()) {
    if (!BLOCK_TYPES_FOR_ANCHOR.has(block.nodeType)) continue;
    try {
      const res = superdoc.ui.viewport.getRect({ target: blockStartTarget(block.nodeId), relativeTo: pageEl });
      if (!res?.found) continue;
      const rect = (res.rects ?? []).find((r) => r.pageIndex === pageIndex) ?? (res.rect?.pageIndex === pageIndex ? res.rect : null);
      if (rect) return { block, rect };
    } catch { /* block has no painted geometry (virtualized); keep looking */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function addTextBox() {
  await withBusy('Adding text box…', async () => {
    const page = pageInView();
    if (!page) throw new Error('No page is rendered yet');
    const hit = await firstBlockOnPage(page.index, page.el);
    if (!hit) throw new Error(`No paragraph with painted geometry found on page ${page.index + 1}`);

    const { files, doc } = await exportPackage();
    const { metrics } = listTextBoxes(doc);
    const { w, h } = DEFAULT_BOX;
    // Right-aligned to the text area, level with the anchor paragraph's first line.
    const x = Math.max(0, metrics.width - metrics.marginRight - w);
    const yFromLayout = hit.rect.top / zoomScale() / PX_PER_PT;
    const y = Math.max(0, Math.min(metrics.height - h, yFromLayout));

    const docPrId = nextDocPrId(doc);
    const sdtId = uniqueSdtId(doc);
    const docPrName = `SDT Text Box ${docPrId}`;
    insertTextBox(doc, {
      anchorParaId: hit.block.nodeId,
      x, y, w, h,
      value: DEFAULT_BOX.value,
      alias: DEFAULT_BOX.alias,
      tag: `textbox-sdt-${sdtId}`,
      sdtId,
      docPrId,
      docPrName,
    });
    await loadPackage(files, doc);
    await waitForSdt(sdtId);
    await refreshBoxes(docPrName);
    revealSdt(sdtId);
    setStatus(`ready — text box added on page ${page.index + 1}, anchored to paragraph ${hit.block.nodeId}`);
  });
}

function revealSdt(id) {
  try { superdoc.ui.contentControls.scrollIntoView?.({ id }); } catch { /* optional nicety */ }
}

async function refreshBoxes(selectKey) {
  await waitForDocumentApi();
  const { doc } = await exportPackage();
  const { boxes, metrics } = listTextBoxes(doc);
  state.boxes = boxes;
  state.metrics = metrics;
  if (selectKey) state.selectedKey = selectKey;
  if (!boxes.some((b) => b.key === state.selectedKey)) state.selectedKey = boxes[0]?.key ?? null;
  renderPanel();
  applySdtSizeCss();
  scheduleMeasure();
}

const pushSdtValue = debounce(async () => {
  const box = selectedBox();
  if (!box?.sdt?.id) return;
  const value = els.value.value;
  try {
    const receipt = await docApi().contentControls.text.setValue({
      target: { kind: 'inline', nodeType: 'sdt', nodeId: box.sdt.id },
      value,
    });
    if (receipt?.success === false) throw new Error(receipt.failure?.message || 'setValue failed');
    box.sdt.value = value;
    setStatus('SDT value updated');
    // SuperDoc may re-measure the box after a content mutation; pick up the new geometry.
    refreshGeometrySoon();
  } catch (e) {
    reportError(e);
  }
}, 250);

async function applyGeometry() {
  const box = selectedBox();
  if (!box) return;
  const geo = { x: num(els.x), y: num(els.y), w: Math.max(10, num(els.w)), h: Math.max(10, num(els.h)) };
  await withBusy('Updating text box geometry…', async () => {
    const { files, doc } = await exportPackage();
    setTextBoxGeometry(doc, box.docPrName, geo);
    await loadPackage(files, doc);
    if (box.sdt?.id) await waitForSdt(box.sdt.id);
    await refreshBoxes(box.key);
  });
}

async function removeSelected() {
  const box = selectedBox();
  if (!box) return;
  await withBusy('Removing text box…', async () => {
    const { files, doc } = await exportPackage();
    removeTextBox(doc, box.docPrName);
    await loadPackage(files, doc);
    await refreshBoxes();
  });
}

async function makeSelectedTransparent() {
  const box = selectedBox();
  if (!box) return;
  await withBusy('Updating text box…', async () => {
    const { files, doc } = await exportPackage();
    makeFloatingTransparent(doc, box.docPrName);
    await loadPackage(files, doc);
    if (box.sdt?.id) await waitForSdt(box.sdt.id);
    await refreshBoxes(box.key);
  });
}

async function downloadDocx() {
  const blob = await superdoc.activeEditor.exportDocx();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'textbox-sdt.docx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// Panel rendering + SDT size sync
// ---------------------------------------------------------------------------

function renderPanel() {
  const box = selectedBox();
  els.panelEmpty.hidden = state.boxes.length > 0;
  els.form.hidden = !box;
  els.select.replaceChildren(...state.boxes.map((b) => {
    const o = document.createElement('option');
    o.value = b.key;
    o.textContent = `${b.docPrName ?? b.key}${b.sdt ? ` — SDT ${b.sdt.id}` : ' — no SDT'}`;
    o.selected = b.key === state.selectedKey;
    return o;
  }));
  if (!box) return;
  if (document.activeElement !== els.value) els.value.value = box.sdt?.value ?? '';
  els.value.disabled = !box.sdt;
  els.x.value = fmt(box.x); els.y.value = fmt(box.y); els.w.value = fmt(box.w); els.h.value = fmt(box.h);
  const isFront = box.wrap === 'wrapNone' && !box.behindDoc;
  els.transparent.hidden = isFront && box.transparent;
  els.info.textContent = [
    `wrap: ${box.wrap}${box.behindDoc ? ' (behind text)' : ''}`,
    `fill: ${box.transparent ? 'transparent' : 'solid'}`,
    `anchor paragraph: ${box.anchorParaId ?? '?'}`,
    `position relative to: ${box.hRelativeFrom}/${box.vRelativeFrom}`,
    box.sdt ? `SDT: id ${box.sdt.id}, tag "${box.sdt.tag ?? ''}", ${box.sdt.isInline ? 'inline' : 'block'}` : 'SDT: none',
    box.hasVmlFallback ? 'has VML fallback' : null,
  ].filter(Boolean).join(' · ');
}

// The SDT is the sole content of the box with zero insets, so width already follows the box.
// This rule stretches the SDT's rendered chrome to the box height too, per SDT id.
const sdtSizeStyle = document.head.appendChild(document.createElement('style'));
function applySdtSizeCss() {
  const scale = zoomScale();
  sdtSizeStyle.textContent = state.boxes
    .filter((b) => b.sdt?.id)
    .map((b) => {
      const innerH = Math.max(0, b.h - b.insets.top - b.insets.bottom) * PX_PER_PT * scale;
      return `#editor .superdoc-textbox-shape .superdoc-structured-content-inline[data-sdt-id="${b.sdt.id}"]` +
        `{display:inline-block;box-sizing:border-box;width:100%;height:${innerH.toFixed(2)}px;vertical-align:top;}`;
    })
    .join('\n');
}

function measureSdt() {
  const box = selectedBox();
  if (!box?.sdt?.id) { els.sdtSize.textContent = ''; return; }
  const span = els.editor.querySelector(`.superdoc-textbox-shape .superdoc-structured-content-inline[data-sdt-id="${box.sdt.id}"]`);
  if (!span) { els.sdtSize.textContent = 'SDT not painted yet (scroll it into view).'; return; }
  const r = span.getBoundingClientRect();
  const k = 1 / (zoomScale() * PX_PER_PT);
  els.sdtSize.textContent = `Rendered SDT size: ${fmt(r.width * k)} × ${fmt(r.height * k)} pt · text box: ${fmt(box.w)} × ${fmt(box.h)} pt`;
}
const scheduleMeasure = debounce(measureSdt, 120);

const refreshGeometrySoon = debounce(() => {
  if (state.busy || document.activeElement === els.value) return;
  refreshBoxes(state.selectedKey).catch(reportError);
}, 900);

// Keep the panel's SDT value in step with edits made directly in the editor (cheap: no export).
const syncSdtValuesFromEditor = debounce(async () => {
  try {
    const res = await docApi()?.contentControls.list();
    for (const box of state.boxes) {
      const item = res?.items?.find((i) => i.id === box.sdt?.id);
      if (item && typeof item.text === 'string') box.sdt.value = item.text;
    }
    if (document.activeElement !== els.value) renderPanel();
  } catch { /* ignore */ }
}, 400);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

els.add.addEventListener('click', () => addTextBox());
els.download.addEventListener('click', () => downloadDocx().catch(reportError));
els.open.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await withBusy(`Opening ${file.name}…`, async () => {
    await superdoc.replaceFile(file);
    await refreshBoxes();
  });
  e.target.value = '';
});
els.select.addEventListener('change', () => { state.selectedKey = els.select.value; renderPanel(); scheduleMeasure(); });
els.value.addEventListener('input', pushSdtValue);
for (const el of [els.x, els.y, els.w, els.h]) el.addEventListener('change', () => applyGeometry());
els.remove.addEventListener('click', () => removeSelected());
els.refresh.addEventListener('click', () => withBusy('Refreshing…', () => refreshBoxes(state.selectedKey)));
els.transparent.addEventListener('click', () => makeSelectedTransparent());

superdoc.on('content-control:click', ({ target }) => {
  const box = state.boxes.find((b) => b.sdt?.id === target?.id);
  if (box) { state.selectedKey = box.key; renderPanel(); scheduleMeasure(); }
});
superdoc.on('zoomChange', () => { applySdtSizeCss(); scheduleMeasure(); });
superdoc.on('editor-update', () => { syncSdtValuesFromEditor(); scheduleMeasure(); });
superdoc.ui.viewport.observe(() => scheduleMeasure());
