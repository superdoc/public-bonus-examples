/**
 * Takes the original PDF bytes plus everything the client collected, writes it all in
 * with pdf-lib, flattens the form and returns the resulting bytes.
 *
 * Every individual write is isolated in a try/catch: one field with an odd value must
 * not cost the user their whole download. Failures come back as warnings.
 */
import {
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFForm,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { PDF_FORM_FIELD_TYPE } from '@embedpdf/models';
import type {
  DesignedFieldDTO,
  FieldValueDTO,
  FlattenRequest,
  FlattenWarning,
  PlacementDTO,
} from '../shared/contract.js';
import {
  deviceRectToImageDraw,
  deviceRectToPdf,
  devicePointToPdf,
  pageFrame,
  parseColor,
} from './geometry.js';

export interface FlattenResult {
  bytes: Uint8Array;
  warnings: FlattenWarning[];
}

export async function flattenPdf(request: FlattenRequest): Promise<FlattenResult> {
  const warnings: FlattenWarning[] = [];
  const record = (scope: string, error: unknown) => {
    warnings.push({ scope, message: error instanceof Error ? error.message : String(error) });
  };

  const doc = await PDFDocument.load(base64ToBytes(request.pdf), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const font = await doc.embedFont(StandardFonts.Helvetica);

  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch (error) {
    record('form', error);
    return { bytes: await doc.save(), warnings };
  }

  // 1. Fields the user drew in Design mode. Created first so the value pass below can
  //    also address them by name.
  for (const designed of request.designedFields) {
    try {
      await createDesignedField(doc, form, designed);
    } catch (error) {
      record(`designedField:${designed.name}`, error);
    }
  }

  // 2. Values from the JSON panel / page interaction.
  for (const field of request.fields) {
    try {
      applyFieldValue(form, field);
    } catch (error) {
      record(`field:${field.name}`, error);
    }
  }

  // 3. Signatures and other placed annotations, drawn as page content.
  for (const [index, placement] of request.placements.entries()) {
    try {
      await drawPlacement(doc, placement);
    } catch (error) {
      record(`placement:${placement.kind}:${index}`, error);
    }
  }

  // 4. Appearances, then flatten so nothing stays editable.
  try {
    form.updateFieldAppearances(font);
  } catch (error) {
    record('updateFieldAppearances', error);
  }

  try {
    form.flatten();
  } catch (error) {
    record('flatten', error);
  }

  return { bytes: await doc.save({ updateFieldAppearances: false }), warnings };
}

/* ------------------------------------------------------------------ values ---- */

function applyFieldValue(form: PDFForm, dto: FieldValueDTO): void {
  const field = form.getFieldMaybe(dto.name);
  if (!field) return;

  if (field instanceof PDFTextField) {
    field.setText(toWinAnsiSafe(dto.value));
    return;
  }

  if (field instanceof PDFCheckBox) {
    // EmbedPDF reports an unchecked box as the literal 'Off'.
    if (isTruthyToggle(dto.value)) field.check();
    else field.uncheck();
    return;
  }

  if (field instanceof PDFRadioGroup) {
    // A radio group's on-state name varies by producer: it can be an export name
    // ('Remote'), an index ('1'), or — when the widget has no /Opt — the widget's NM,
    // which is a UUID. So try the raw value first, then the option label the client
    // resolved from the widget's own appearance state.
    if (isExplicitlyEmpty(dto.value) && !dto.selectedLabel) {
      field.clear();
      return;
    }
    const choice = matchOption(field.getOptions(), [dto.value, dto.selectedLabel]);
    if (!choice) {
      // Leaving the existing selection alone is far better than clearing it, which
      // would silently drop a value the user never touched.
      throw new Error(
        `no option matches ${JSON.stringify(dto.selectedLabel ?? dto.value)} in [${field.getOptions().join(', ')}] — selection left unchanged`,
      );
    }
    field.select(choice);
    return;
  }

  if (field instanceof PDFDropdown) {
    if (isExplicitlyEmpty(dto.value) && !dto.selectedLabel) {
      field.clear();
      return;
    }
    const choice = matchOption(field.getOptions(), [dto.selectedLabel, dto.value]);
    if (choice) {
      field.select(choice);
      return;
    }
    // Combo boxes may be free-text ("editable"), so widen the option list rather than
    // rejecting the value.
    const freeText = toWinAnsiSafe(dto.selectedLabel ?? dto.value);
    field.addOptions(freeText);
    field.select(freeText);
    return;
  }

  if (field instanceof PDFOptionList) {
    if (isExplicitlyEmpty(dto.value) && !dto.selectedLabel) {
      field.clear();
      return;
    }
    const choice = matchOption(field.getOptions(), [dto.selectedLabel, dto.value]);
    if (choice) {
      field.select(choice);
      return;
    }
    const extra = toWinAnsiSafe(dto.selectedLabel ?? dto.value);
    field.addOptions(extra);
    field.select(extra);
    return;
  }

  // Push buttons and signature fields carry no value to write.
}

/* --------------------------------------------------------- designed fields ---- */

async function createDesignedField(
  doc: PDFDocument,
  form: PDFForm,
  dto: DesignedFieldDTO,
): Promise<void> {
  const page = pageAt(doc, dto.pageIndex);
  const box = deviceRectToPdf(dto.rect, pageFrame(page));
  const appearance = { x: box.x, y: box.y, width: box.width, height: box.height };

  if (form.getFieldMaybe(dto.name)) {
    // The widget already exists (the viewer created it and it round-tripped through
    // the uploaded bytes), so only the value pass needs to run.
    return;
  }

  switch (dto.kind) {
    case 'text': {
      const field = form.createTextField(dto.name);
      field.addToPage(page, {
        ...appearance,
        borderWidth: 1,
        borderColor: rgb(0.58, 0.64, 0.72),
      });
      // setFontSize requires the /DA entry that addToPage creates.
      field.setFontSize(11);
      if (dto.value) field.setText(toWinAnsiSafe(dto.value));
      return;
    }
    case 'checkbox': {
      const field = form.createCheckBox(dto.name);
      field.addToPage(page, {
        ...appearance,
        borderWidth: 1,
        borderColor: rgb(0.58, 0.64, 0.72),
      });
      if (isTruthyToggle(dto.value)) field.check();
      else field.uncheck();
      return;
    }
    case 'image': {
      // AcroForm has no image field type; a push button carrying an image appearance is
      // the standard equivalent and is what pdf-lib's setImage() targets.
      const field = form.createButton(dto.name);
      field.addToPage('', page, {
        ...appearance,
        borderWidth: 1,
        borderColor: rgb(0.58, 0.64, 0.72),
      });
      if (dto.imageBase64) {
        const image = await embedImage(doc, dto.imageBase64, dto.imageMimeType);
        field.setImage(image);
      }
      return;
    }
  }
}

/* -------------------------------------------------------------- placements ---- */

async function drawPlacement(doc: PDFDocument, placement: PlacementDTO): Promise<void> {
  const page = pageAt(doc, placement.pageIndex);
  const frame = pageFrame(page);

  if (placement.kind === 'stamp') {
    const bytes = base64ToBytes(placement.imageBase64);
    const draw = deviceRectToImageDraw(placement.rect, frame);

    // EmbedPDF's exportAnnotations() hands back a stamp's appearance as a one-page PDF
    // (mimeType 'application/pdf'), not as an image. Embedding that keeps the signature
    // as vector content; raw PNG/JPEG bytes are also accepted for uploaded images.
    if (looksLikePdf(bytes)) {
      const [embedded] = await doc.embedPdf(bytes);
      page.drawPage(embedded, draw);
      return;
    }

    const image = await embedImage(doc, bytes, placement.mimeType);
    page.drawImage(image, draw);
    return;
  }

  // Ink: redraw each stroke as a polyline. Points are absolute page device coords, so
  // they convert independently and stay correct on rotated pages.
  const color = parseColor(placement.strokeColor);
  for (const stroke of placement.inkList) {
    for (let i = 1; i < stroke.points.length; i += 1) {
      page.drawLine({
        start: devicePointToPdf(stroke.points[i - 1], frame),
        end: devicePointToPdf(stroke.points[i], frame),
        thickness: placement.strokeWidth || 1,
        color: rgb(color.r, color.g, color.b),
        lineCap: LineCapStyle.Round,
      });
    }
    // A single-point stroke (a dot) would otherwise draw nothing.
    if (stroke.points.length === 1) {
      const p = devicePointToPdf(stroke.points[0], frame);
      page.drawCircle({
        x: p.x,
        y: p.y,
        size: Math.max(placement.strokeWidth, 1) / 2,
        color: rgb(color.r, color.g, color.b),
      });
    }
  }
}

/* ------------------------------------------------------------------ helpers ---- */

function pageAt(doc: PDFDocument, pageIndex: number): PDFPage {
  const pages = doc.getPages();
  const page = pages[pageIndex];
  if (!page) throw new Error(`page ${pageIndex} does not exist (document has ${pages.length})`);
  return page;
}

async function embedImage(
  doc: PDFDocument,
  source: string | Uint8Array,
  mimeType: string | undefined,
): Promise<PDFImage> {
  const bytes = typeof source === 'string' ? base64ToBytes(source) : source;
  const isJpeg = mimeType?.includes('jpeg') || mimeType?.includes('jpg') || looksLikeJpeg(bytes);
  return isJpeg ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** '%PDF' magic. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

/**
 * Resolves a choice value against a field's declared options.
 *
 * Producers disagree on what a choice field's value looks like, so all three forms are
 * accepted: the option text itself, the option's index (pdf-lib names its generated
 * appearance states '0', '1', '2' — which is what EmbedPDF then reports as the value),
 * and the label the client read off the widget's appearance state.
 */
function matchOption(options: string[], candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && options.includes(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const asIndex = Number(candidate.trim());
    if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < options.length) {
      return options[asIndex];
    }
  }

  return undefined;
}

/** True only when the user really means "nothing selected". */
function isExplicitlyEmpty(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '' || normalized === 'off';
}

function isTruthyToggle(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== 'off' && normalized !== 'false' && normalized !== '0' && normalized !== '';
}

/**
 * The standard fonts pdf-lib uses for field appearances only encode WinAnsi, and it
 * throws on anything outside it. Map the characters people actually paste, then drop
 * the rest rather than failing the field.
 */
const WIN_ANSI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
  [/[•·]/g, '-'],
];

export function toWinAnsiSafe(value: string | undefined): string {
  let out = value ?? '';
  for (const [pattern, replacement] of WIN_ANSI_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  // Keep tab/newline plus every printable WinAnsi code point; drop the rest.
  return out.replace(/[^\t\n\r\x20-\x7E\xA1-\xFF]/g, '');
}
