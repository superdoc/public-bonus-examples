/**
 * The one and only coordinate conversion in this app.
 *
 * EmbedPDF hands us annotation rects and pointer positions in what its engine calls
 * "device" space: PDF points, **origin top-left**, relative to the page's *unrotated*
 * size, with the MediaBox origin already subtracted. pdf-lib draws in PDF user space:
 * origin bottom-left, MediaBox origin included.
 *
 * The functions below are the exact inverse of the engine's
 * `convertPagePointToDevicePoint` (verified against @embedpdf/engines 2.15.0):
 *
 *   px = pdfX - originX,  py = pdfY - originY
 *   r=0: dx = px,       dy = DH - py
 *   r=1: dx = py,       dy = px
 *   r=2: dx = DW - px,  dy = py
 *   r=3: dx = DW - py,  dy = DH - px
 *
 * ...where DW/DH are the unrotated page width/height and r is the page rotation in
 * quarter turns. Inverting each branch gives `devicePointToPdf` below.
 */
import type { PDFPage } from 'pdf-lib';
import { degrees } from 'pdf-lib';
import type { RectDTO } from '../shared/contract.js';

export interface PageFrame {
  /** MediaBox origin. */
  originX: number;
  originY: number;
  /** Unrotated page size (MediaBox width/height). */
  width: number;
  height: number;
  /** Page rotation in quarter turns, 0-3. */
  quarterTurns: number;
}

export function pageFrame(page: PDFPage): PageFrame {
  const box = page.getMediaBox();
  const deg = ((page.getRotation().angle % 360) + 360) % 360;
  return {
    originX: box.x,
    originY: box.y,
    width: box.width,
    height: box.height,
    quarterTurns: Math.round(deg / 90) % 4,
  };
}

export interface Point {
  x: number;
  y: number;
}

/** Top-left device point -> PDF user-space point. */
export function devicePointToPdf(p: Point, frame: PageFrame): Point {
  const { width: DW, height: DH, quarterTurns: r } = frame;
  let px: number;
  let py: number;
  switch (r) {
    case 1:
      px = p.y;
      py = p.x;
      break;
    case 2:
      px = DW - p.x;
      py = p.y;
      break;
    case 3:
      px = DH - p.y;
      py = DW - p.x;
      break;
    default:
      px = p.x;
      py = DH - p.y;
  }
  return { x: px + frame.originX, y: py + frame.originY };
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Top-left device rect -> axis-aligned PDF user-space rect.
 *
 * Both opposite corners are transformed and then min/max'd, so this stays correct for
 * every rotation (width and height swap for 90/270, as they should).
 */
export function deviceRectToPdf(rect: RectDTO, frame: PageFrame): PdfRect {
  const a = devicePointToPdf(rect.origin, frame);
  const b = devicePointToPdf(
    { x: rect.origin.x + rect.size.width, y: rect.origin.y + rect.size.height },
    frame,
  );
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Draw parameters for an image that must appear upright in the *displayed* (rotated)
 * page. The image is counter-rotated so the viewer's page rotation cancels it out.
 *
 * pdf-lib rotates counter-clockwise about the anchor `(x, y)`, so each rotation needs
 * a different corner of the target rect as the anchor.
 */
export function deviceRectToImageDraw(
  rect: RectDTO,
  frame: PageFrame,
): PdfRect & { rotate: ReturnType<typeof degrees> } {
  const target = deviceRectToPdf(rect, frame);
  const { width: w, height: h } = rect.size;

  switch (frame.quarterTurns) {
    case 1:
      // Occupies x ∈ [anchorX - h, anchorX], y ∈ [anchorY, anchorY + w].
      return { x: target.x + target.width, y: target.y, width: w, height: h, rotate: degrees(90) };
    case 2:
      return {
        x: target.x + target.width,
        y: target.y + target.height,
        width: w,
        height: h,
        rotate: degrees(180),
      };
    case 3:
      // Occupies x ∈ [anchorX, anchorX + h], y ∈ [anchorY - w, anchorY].
      return {
        x: target.x,
        y: target.y + target.height,
        width: w,
        height: h,
        rotate: degrees(270),
      };
    default:
      return { ...target, rotate: degrees(0) };
  }
}

/** #rrggbb / #rgb / rgb(...) -> pdf-lib rgb components in 0..1. Falls back to black. */
export function parseColor(input: string | undefined): { r: number; g: number; b: number } {
  const fallback = { r: 0, g: 0, b: 0 };
  if (!input) return fallback;
  const hex = input.trim();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16) / 255,
      g: parseInt(short[2] + short[2], 16) / 255,
      b: parseInt(short[3] + short[3], 16) / 255,
    };
  }

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (long) {
    return {
      r: parseInt(long[1], 16) / 255,
      g: parseInt(long[2], 16) / 255,
      b: parseInt(long[3], 16) / 255,
    };
  }

  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(hex);
  if (fn) {
    return {
      r: Number(fn[1]) / 255,
      g: Number(fn[2]) / 255,
      b: Number(fn[3]) / 255,
    };
  }

  return fallback;
}
