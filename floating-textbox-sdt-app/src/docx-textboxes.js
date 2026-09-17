// DOCX-level helpers for floating text boxes that contain an inline SDT.
//
// SuperDoc's browser Document API can read and set the SDT value inside a text
// box, but it has no operation that creates or repositions a text box. So the
// app works at the package level: export the current DOCX, patch
// word/document.xml, and load the result back with `superdoc.replaceFile()`.

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  v: 'urn:schemas-microsoft-com:vml',
  xmlns: 'http://www.w3.org/2000/xmlns/',
};

const EMU_PER_PT = 12700;
export const ptToEmu = (pt) => Math.round(Number(pt) * EMU_PER_PT);
export const emuToPt = (emu) => Number(emu) / EMU_PER_PT;
const twipsToPt = (tw) => Number(tw) / 20;

// ---------------------------------------------------------------------------
// Package I/O
// ---------------------------------------------------------------------------

export async function readPackage(blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const part = files['word/document.xml'];
  if (!part) throw new Error('word/document.xml missing from exported package');
  return { files, doc: parseXml(strFromU8(part)) };
}

export function writePackage(files, doc) {
  files['word/document.xml'] = strToU8(serializeXml(doc));
  return new Blob([zipSync(files, { level: 6 })], { type: DOCX_MIME });
}

export function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('document.xml did not parse: ' + err.textContent.slice(0, 200));
  return doc;
}

export function serializeXml(doc) {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml') ? xml : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const first = (el, ns, name) => (el ? el.getElementsByTagNameNS(ns, name)[0] || null : null);
const childNS = (el, ns, name) => Array.from(el?.childNodes || []).find((n) => n.namespaceURI === ns && n.localName === name) || null;
const wVal = (el) => (el ? el.getAttributeNS(NS.w, 'val') : null);

/** Page size and margins (pt) from the last w:sectPr in the body. */
export function readPageMetrics(doc) {
  const sects = doc.getElementsByTagNameNS(NS.w, 'sectPr');
  const sect = sects[sects.length - 1];
  const pgSz = first(sect, NS.w, 'pgSz');
  const pgMar = first(sect, NS.w, 'pgMar');
  const attr = (el, name, fallback) => (el && el.hasAttributeNS(NS.w, name) ? twipsToPt(el.getAttributeNS(NS.w, name)) : fallback);
  return {
    width: attr(pgSz, 'w', 612),
    height: attr(pgSz, 'h', 792),
    marginTop: attr(pgMar, 'top', 72),
    marginRight: attr(pgMar, 'right', 72),
    marginBottom: attr(pgMar, 'bottom', 72),
    marginLeft: attr(pgMar, 'left', 72),
  };
}

function paragraphIdOf(el) {
  let p = el;
  while (p && !(p.namespaceURI === NS.w && p.localName === 'p')) p = p.parentNode;
  return p ? p.getAttributeNS(NS.w14, 'paraId') : null;
}

/** Resolve a wp:positionH / wp:positionV element to an absolute page offset in pt. */
function resolvePosition(posEl, axis, size, metrics) {
  if (!posEl) return { relativeFrom: 'page', offset: 0, mode: 'missing' };
  const relativeFrom = posEl.getAttribute('relativeFrom') || 'page';
  const posOffset = childNS(posEl, NS.wp, 'posOffset');
  const align = childNS(posEl, NS.wp, 'align');
  const isH = axis === 'h';
  const base = relativeFrom === 'margin' || relativeFrom === 'column' || relativeFrom === 'paragraph'
    ? (isH ? metrics.marginLeft : metrics.marginTop)
    : 0;
  if (posOffset) return { relativeFrom, offset: base + emuToPt(posOffset.textContent), mode: 'offset' };
  if (align) {
    const span = isH ? metrics.width - metrics.marginLeft - metrics.marginRight : metrics.height - metrics.marginTop - metrics.marginBottom;
    const full = isH ? metrics.width : metrics.height;
    const extent = relativeFrom === 'page' ? full : span;
    const v = align.textContent.trim();
    let off = 0;
    if (v === 'center') off = (extent - size) / 2;
    else if (v === 'right' || v === 'bottom' || v === 'outside') off = extent - size;
    return { relativeFrom, offset: base + off, mode: 'align:' + v };
  }
  return { relativeFrom, offset: base, mode: 'unknown' };
}

/**
 * List every DrawingML text box (wp:anchor with wps:txbx) in the body and the
 * first SDT it contains. Geometry is in pt, position is absolute on the page.
 */
export function listTextBoxes(doc) {
  const metrics = readPageMetrics(doc);
  const boxes = [];
  for (const anchor of Array.from(doc.getElementsByTagNameNS(NS.wp, 'anchor'))) {
    const txbx = first(anchor, NS.wps, 'txbx');
    if (!txbx) continue;
    const docPr = first(anchor, NS.wp, 'docPr');
    const extent = first(anchor, NS.wp, 'extent');
    const w = extent ? emuToPt(extent.getAttribute('cx')) : 0;
    const h = extent ? emuToPt(extent.getAttribute('cy')) : 0;
    const posH = resolvePosition(childNS(anchor, NS.wp, 'positionH'), 'h', w, metrics);
    const posV = resolvePosition(childNS(anchor, NS.wp, 'positionV'), 'v', h, metrics);
    const wrapEl = Array.from(anchor.childNodes).find((n) => n.namespaceURI === NS.wp && /^wrap/.test(n.localName));
    const spPr = first(anchor, NS.wps, 'spPr');
    const bodyPr = first(anchor, NS.wps, 'bodyPr');
    const inset = (name) => (bodyPr && bodyPr.hasAttribute(name) ? emuToPt(bodyPr.getAttribute(name)) : 7.2);
    const sdt = first(first(txbx, NS.w, 'txbxContent'), NS.w, 'sdt');
    const sdtPr = sdt ? childNS(sdt, NS.w, 'sdtPr') : null;
    const sdtContent = sdt ? childNS(sdt, NS.w, 'sdtContent') : null;
    // wp:anchor -> w:drawing -> mc:Choice -> mc:AlternateContent (when Word wrote a VML fallback)
    const alternate = anchor.parentNode?.parentNode?.parentNode ?? null;
    boxes.push({
      key: docPr?.getAttribute('name') || `docPr-${docPr?.getAttribute('id') ?? boxes.length}`,
      docPrId: docPr?.getAttribute('id') ?? null,
      docPrName: docPr?.getAttribute('name') ?? null,
      anchorParaId: paragraphIdOf(anchor),
      x: posH.offset,
      y: posV.offset,
      w,
      h,
      hRelativeFrom: posH.relativeFrom,
      vRelativeFrom: posV.relativeFrom,
      wrap: wrapEl ? wrapEl.localName : 'none?',
      behindDoc: anchor.getAttribute('behindDoc') === '1',
      transparent: !!(spPr && childNS(spPr, NS.a, 'noFill')),
      insets: { left: inset('lIns'), top: inset('tIns'), right: inset('rIns'), bottom: inset('bIns') },
      hasVmlFallback: !!(alternate && alternate.namespaceURI === NS.mc && alternate.localName === 'AlternateContent' && first(alternate, NS.v, 'shape')),
      sdt: sdt
        ? {
            id: wVal(childNS(sdtPr, NS.w, 'id')),
            tag: wVal(childNS(sdtPr, NS.w, 'tag')),
            alias: wVal(childNS(sdtPr, NS.w, 'alias')),
            isInline: sdt.parentNode?.namespaceURI === NS.w && sdt.parentNode?.localName === 'p',
            value: sdtContent ? Array.from(sdtContent.getElementsByTagNameNS(NS.w, 't')).map((t) => t.textContent).join('') : '',
          }
        : null,
    });
  }
  return { boxes, metrics };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function ensureNamespaces(doc) {
  const root = doc.documentElement;
  for (const prefix of ['w', 'w14', 'wp', 'a', 'wps']) {
    if (!root.hasAttributeNS(NS.xmlns, prefix)) root.setAttributeNS(NS.xmlns, `xmlns:${prefix}`, NS[prefix]);
  }
}

function findParagraphById(doc, paraId) {
  return Array.from(doc.getElementsByTagNameNS(NS.w, 'p')).find((p) => p.getAttributeNS(NS.w14, 'paraId') === paraId) || null;
}

export function findAnchorByName(doc, docPrName) {
  for (const anchor of Array.from(doc.getElementsByTagNameNS(NS.wp, 'anchor'))) {
    const docPr = first(anchor, NS.wp, 'docPr');
    if (docPr && docPr.getAttribute('name') === docPrName) return anchor;
  }
  return null;
}

export function nextDocPrId(doc) {
  let max = 0;
  for (const el of Array.from(doc.getElementsByTagNameNS(NS.wp, 'docPr'))) max = Math.max(max, Number(el.getAttribute('id')) || 0);
  return max + 1;
}

export function uniqueSdtId(doc) {
  const used = new Set(Array.from(doc.getElementsByTagNameNS(NS.w, 'id')).map((el) => wVal(el)));
  let id;
  do id = String(100000000 + Math.floor(Math.random() * 1900000000));
  while (used.has(id));
  return id;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * XML for one run holding a floating text box:
 *  - wp:anchor, In Front of Text (wp:wrapNone, behindDoc="0"), absolute page position
 *  - transparent background (a:noFill) with a thin outline
 *  - zero text insets so the inline SDT fills the whole box
 *  - one paragraph whose only content is an inline plain-text SDT
 */
export function textBoxRunXml({ x, y, w, h, value, alias, tag, sdtId, docPrId, docPrName }) {
  const cx = ptToEmu(w);
  const cy = ptToEmu(h);
  return `<w:r xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:wps="${NS.wps}"><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + docPrId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${ptToEmu(x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${ptToEmu(y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/>` +
    `<wp:docPr id="${docPrId}" name="${esc(docPrName)}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>` +
    `<wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/><a:ln w="6350"><a:solidFill><a:srgbClr val="808080"/></a:solidFill></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>` +
    `<w:sdt><w:sdtPr><w:alias w:val="${esc(alias)}"/><w:tag w:val="${esc(tag)}"/><w:id w:val="${sdtId}"/><w:text/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t xml:space="preserve">${esc(value)}</w:t></w:r></w:sdtContent></w:sdt>` +
    `</w:p></w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>` +
    `</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

/** Insert a new text box run at the start of the paragraph with the given w14:paraId. */
export function insertTextBox(doc, { anchorParaId, ...spec }) {
  ensureNamespaces(doc);
  const para = findParagraphById(doc, anchorParaId);
  if (!para) throw new Error(`Paragraph ${anchorParaId} not found in document.xml`);
  const runDoc = parseXml(textBoxRunXml(spec));
  const run = doc.importNode(runDoc.documentElement, true);
  const pPr = childNS(para, NS.w, 'pPr');
  para.insertBefore(run, pPr ? pPr.nextSibling : para.firstChild);
  return run;
}

/** Update position (absolute page pt) and size (pt) of an existing text box. */
export function setTextBoxGeometry(doc, docPrName, { x, y, w, h }) {
  const anchor = findAnchorByName(doc, docPrName);
  if (!anchor) throw new Error(`Text box "${docPrName}" not found`);
  const cx = ptToEmu(w);
  const cy = ptToEmu(h);
  for (const [name, value] of [['positionH', x], ['positionV', y]]) {
    let pos = childNS(anchor, NS.wp, name);
    if (!pos) {
      pos = doc.createElementNS(NS.wp, `wp:${name}`);
      anchor.insertBefore(pos, childNS(anchor, NS.wp, 'extent'));
    }
    pos.setAttribute('relativeFrom', 'page');
    while (pos.firstChild) pos.removeChild(pos.firstChild);
    const off = doc.createElementNS(NS.wp, 'wp:posOffset');
    off.textContent = String(ptToEmu(value));
    pos.appendChild(off);
  }
  const extent = first(anchor, NS.wp, 'extent');
  extent.setAttribute('cx', String(cx));
  extent.setAttribute('cy', String(cy));
  const ext = first(first(anchor, NS.wps, 'spPr'), NS.a, 'ext');
  if (ext) { ext.setAttribute('cx', String(cx)); ext.setAttribute('cy', String(cy)); }
  // Keep a legacy VML fallback (if the file has one) in step with the DrawingML branch.
  const alternate = anchor.parentNode?.parentNode?.parentNode;
  if (alternate && alternate.namespaceURI === NS.mc && alternate.localName === 'AlternateContent') {
    const shape = first(alternate, NS.v, 'shape');
    if (shape) {
      const style = (shape.getAttribute('style') || '')
        .replace(/margin-left:[^;]*/, `margin-left:${x}pt`).replace(/margin-top:[^;]*/, `margin-top:${y}pt`)
        .replace(/width:[^;]*/, `width:${w}pt`).replace(/height:[^;]*/, `height:${h}pt`)
        .replace(/mso-position-horizontal-relative:[^;]*/, 'mso-position-horizontal-relative:page')
        .replace(/mso-position-vertical-relative:[^;]*/, 'mso-position-vertical-relative:page')
        .replace(/mso-position-horizontal:[^;]*;?/, '').replace(/mso-position-vertical:[^;]*;?/, '');
      shape.setAttribute('style', style);
    }
  }
}

/** Make an existing text box In Front of Text with a transparent fill. */
export function makeFloatingTransparent(doc, docPrName) {
  const anchor = findAnchorByName(doc, docPrName);
  if (!anchor) throw new Error(`Text box "${docPrName}" not found`);
  const wrapEl = Array.from(anchor.childNodes).find((n) => n.namespaceURI === NS.wp && /^wrap/.test(n.localName));
  const wrapNone = doc.createElementNS(NS.wp, 'wp:wrapNone');
  if (wrapEl) anchor.replaceChild(wrapNone, wrapEl);
  else anchor.insertBefore(wrapNone, first(anchor, NS.wp, 'docPr'));
  anchor.setAttribute('behindDoc', '0');
  const spPr = first(anchor, NS.wps, 'spPr');
  if (spPr) {
    const fill = childNS(spPr, NS.a, 'solidFill') || childNS(spPr, NS.a, 'gradFill') || childNS(spPr, NS.a, 'pattFill') || childNS(spPr, NS.a, 'blipFill');
    const noFill = doc.createElementNS(NS.a, 'a:noFill');
    if (fill) spPr.replaceChild(noFill, fill);
    else if (!childNS(spPr, NS.a, 'noFill')) spPr.insertBefore(noFill, childNS(spPr, NS.a, 'ln'));
  }
}

/** Remove the run that holds the text box (including any mc:AlternateContent wrapper). */
export function removeTextBox(doc, docPrName) {
  const anchor = findAnchorByName(doc, docPrName);
  if (!anchor) throw new Error(`Text box "${docPrName}" not found`);
  let run = anchor;
  while (run && !(run.namespaceURI === NS.w && run.localName === 'r')) run = run.parentNode;
  if (!run) throw new Error('Text box is not inside a run');
  run.parentNode.removeChild(run);
}
