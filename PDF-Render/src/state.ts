/**
 * Small module-level store. Two things need to outlive individual components:
 *
 *  - `sourcePdf`: the bytes the server flattens. The viewer's copy lives inside the
 *    pdfium worker and cannot be read back, so we keep our own from the moment the
 *    file is chosen.
 *  - `designedFields`: fields the user drew in Design mode. The server has to recreate
 *    them with pdf-lib, so this store — not the viewer — is the source of truth.
 */
import { ref } from 'vue';
import type { DesignedFieldDTO, DesignedFieldKind } from '@shared/contract';

export interface SourcePdf {
  bytes: Uint8Array;
  name: string;
}

export const sourcePdf = ref<SourcePdf | null>(null);

export interface DesignedField extends DesignedFieldDTO {
  /**
   * Id of the widget annotation the viewer created for this field. Kept so a rename can
   * also be pushed to the live widget; not part of the server payload.
   */
  annotationId?: string;
}

export const designedFields = ref<DesignedField[]>([]);

/** Id of the signature entry currently being dragged towards the page, if any. */
export const draggingSignatureId = ref<string | null>(null);

/** Which insert tool is armed, plus the image chosen for an image field. */
export const armedField = ref<{ kind: DesignedFieldKind; imageBase64?: string; imageMimeType?: string } | null>(null);

export const isDownloading = ref(false);

export const statusMessage = ref<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null);

export function setStatus(tone: 'info' | 'error' | 'success', text: string): void {
  statusMessage.value = { tone, text };
}

export function clearStatus(): void {
  statusMessage.value = null;
}

/** Replaces the document being edited; designed fields belong to the old one. */
export function setSourcePdf(next: SourcePdf): void {
  sourcePdf.value = next;
  designedFields.value = [];
  armedField.value = null;
}

export function addDesignedField(field: DesignedField): void {
  designedFields.value = [...designedFields.value, field];
}

export function removeDesignedField(name: string): void {
  designedFields.value = designedFields.value.filter((field) => field.name !== name);
}

/**
 * Renames a field the user drew. Returns an error message, or null on success.
 *
 * `takenNames` should hold the names already used by the document's own form fields, so
 * a rename cannot silently merge a new field into an existing one — in a PDF, two
 * widgets sharing a name are two views of the *same* field.
 */
export function renameDesignedField(
  currentName: string,
  nextName: string,
  takenNames: Iterable<string> = [],
): string | null {
  const trimmed = nextName.trim();

  if (trimmed === currentName) return null;
  if (!trimmed) return 'Name cannot be empty.';
  // '.' separates parent and child in a PDF field name, so it cannot appear in a leaf.
  if (trimmed.includes('.')) return 'Name cannot contain a dot.';

  const clash =
    designedFields.value.some((field) => field.name !== currentName && field.name === trimmed) ||
    [...takenNames].includes(trimmed);
  if (clash) return 'That name is already used by another field.';

  designedFields.value = designedFields.value.map((field) =>
    field.name === currentName ? { ...field, name: trimmed } : field,
  );
  return null;
}

/** Unique-ish field name that is still readable in the exported PDF. */
export function nextFieldName(kind: DesignedFieldKind): string {
  const prefix = kind === 'text' ? 'Custom_Text' : kind === 'checkbox' ? 'Custom_Checkbox' : 'Custom_Image';
  const used = new Set(designedFields.value.map((field) => field.name));
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}
