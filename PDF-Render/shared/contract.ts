/**
 * Wire contract between the Vue client and the Node/pdf-lib backend.
 *
 * Types only — this module is erased at build time, so both sides import it with
 * `import type` and neither needs to resolve it at runtime.
 *
 * Coordinate convention for every `RectDTO` and every point in this file:
 * PDF points, **origin top-left**, relative to the page's unrotated size, with the
 * MediaBox origin already subtracted. This is exactly what EmbedPDF's annotation
 * `rect` and page-pointer positions use, so the client never converts anything —
 * `server/geometry.ts` owns the single flip to pdf-lib's bottom-left space.
 */
import type { PDF_FORM_FIELD_TYPE } from '@embedpdf/models';

export interface RectDTO {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

export interface FieldValueDTO {
  name: string;
  /** EmbedPDF's field type, used by the server to pick the right pdf-lib setter. */
  type: PDF_FORM_FIELD_TYPE;
  /** Raw value as reported by `getFormValues()`. */
  value: string;
  /**
   * For RADIOBUTTON / COMBOBOX / LISTBOX only: the human-readable option label.
   * Required because `getFormValues()` reports a radio button's value as the
   * widget's NM (a UUID), which pdf-lib's `select()` would reject.
   */
  selectedLabel?: string;
}

export type DesignedFieldKind = 'text' | 'checkbox' | 'image';

/** A form field the user drew in Design mode; the server creates it from scratch. */
export interface DesignedFieldDTO {
  name: string;
  kind: DesignedFieldKind;
  pageIndex: number;
  rect: RectDTO;
  /** Text contents, or 'on'/'off' for a checkbox. */
  value?: string;
  /** For `kind: 'image'`: base64 image to stamp into the button's appearance. */
  imageBase64?: string;
  imageMimeType?: string;
}

/** A signature (or any stamp/ink annotation) the user placed on a page. */
export type PlacementDTO =
  | {
      kind: 'stamp';
      pageIndex: number;
      rect: RectDTO;
      imageBase64: string;
      mimeType: string;
    }
  | {
      kind: 'ink';
      pageIndex: number;
      rect: RectDTO;
      inkList: Array<{ points: Array<{ x: number; y: number }> }>;
      strokeColor: string;
      strokeWidth: number;
    };

export interface FlattenRequest {
  /** base64-encoded bytes of the *original* uploaded PDF. */
  pdf: string;
  fileName?: string;
  fields: FieldValueDTO[];
  designedFields: DesignedFieldDTO[];
  placements: PlacementDTO[];
}

/** Returned as an `X-Flatten-Warnings` header so the client can surface partial failures. */
export interface FlattenWarning {
  scope: string;
  message: string;
}
