/**
 * Two-way bridge between the form plugin's state and the editable JSON panel.
 *
 * The loop guard matters: `setFormValues()` triggers `onFieldValueChange`, which would
 * otherwise rewrite the textarea under the user's cursor mid-keystroke. While the
 * textarea is focused we keep refreshing `values`/`fields` (the download needs them)
 * but leave `text` alone.
 */
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useFormCapability, type FormFieldInfo } from '@embedpdf/plugin-form/vue';
import { PDF_FORM_FIELD_TYPE } from '@embedpdf/models';
import type { FieldValueDTO } from '@shared/contract';

const DEBOUNCE_MS = 300;

export interface UseFormJson {
  text: Ref<string>;
  parseError: Ref<string | null>;
  fieldCount: ComputedRef<number>;
  onInput: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** Values + type metadata the flatten endpoint needs. */
  toFieldDTOs: () => FieldValueDTO[];
  setValues: (values: Record<string, string>) => void;
  getFields: () => FormFieldInfo[];
  /** Best-effort rename of a widget in the live document. */
  renameWidget: (annotationId: string, name: string) => void;
  refresh: () => void;
}

export function useFormJson(documentId: () => string): UseFormJson {
  const { provides: formCapability } = useFormCapability();

  const values = ref<Record<string, string>>({});
  const fields = ref<FormFieldInfo[]>([]);
  const text = ref('{}');
  const parseError = ref<string | null>(null);
  const isEditing = ref(false);

  const scope = computed(() => {
    const capability = formCapability.value;
    const id = documentId();
    return capability && id ? capability.forDocument(id) : null;
  });

  function refresh(): void {
    const active = scope.value;
    if (!active) return;
    values.value = active.getFormValues();
    fields.value = active.getFormFields();
    if (!isEditing.value) {
      text.value = JSON.stringify(values.value, null, 2);
      parseError.value = null;
    }
  }

  // Re-subscribe whenever the document (or the capability) changes.
  watch(
    scope,
    (active, _previous, onCleanup) => {
      if (!active) return;
      refresh();
      const stopReady = active.onFormReady(() => refresh());
      const stopChange = active.onFieldValueChange(() => refresh());
      onCleanup(() => {
        stopReady();
        stopChange();
      });
    },
    { immediate: true },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  function commit(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parseError.value = error instanceof Error ? error.message : 'Invalid JSON';
      return;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parseError.value = 'Expected a JSON object of field name → value';
      return;
    }

    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      next[key] = value === null || value === undefined ? '' : String(value);
    }

    parseError.value = null;

    // Only send fields the user actually changed. Writing every key back would be
    // destructive: the plugin treats any value other than 'Off' as "checked", and an
    // unchecked box reads back as '', so re-sending the untouched '' would tick every
    // checkbox on the page.
    const current = values.value;
    const toggles = new Set(
      fields.value
        .filter((field) => field.type === PDF_FORM_FIELD_TYPE.CHECKBOX)
        .map((field) => field.name),
    );

    const changes: Record<string, string> = {};
    for (const [key, raw] of Object.entries(next)) {
      if ((current[key] ?? '') === raw) continue;
      changes[key] = toggles.has(key) && !isCheckedValue(raw) ? 'Off' : raw;
    }

    values.value = { ...current, ...next };
    if (Object.keys(changes).length > 0) scope.value?.setFormValues(changes);
  }

  /** Anything but an explicit off-ish value ticks a checkbox. */
  function isCheckedValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'off' && normalized !== 'false' && normalized !== '0';
  }

  function onInput(next: string): void {
    // `isEditing` is driven by focus/blur only. Typing always implies focus, and setting
    // it here too would leave the panel stuck in editing mode after a programmatic
    // change, so it would stop reflecting the document.
    text.value = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => commit(next), DEBOUNCE_MS);
  }

  function onFocus(): void {
    isEditing.value = true;
  }

  function onBlur(): void {
    if (timer) clearTimeout(timer);
    commit(text.value);
    isEditing.value = false;
    refresh();
  }

  function toFieldDTOs(): FieldValueDTO[] {
    return fields.value.map((field) => {
      const value = values.value[field.name] ?? field.value;
      const dto: FieldValueDTO = { name: field.name, type: field.type, value };

      if (field.options && field.options.length > 0) {
        // Prefer an option matching the value the user typed; fall back to whatever the
        // engine currently reports as selected. Radio buttons need this because their
        // raw value is the widget's NM (a UUID), never an option label.
        const byValue = field.options.find((option) => option.label === value)?.label;
        const byFlag = field.options.find((option) => option.isSelected)?.label;
        dto.selectedLabel = byValue ?? byFlag;
      }

      return dto;
    });
  }

  function setValues(next: Record<string, string>): void {
    scope.value?.setFormValues(next);
    // setFormValues fires onFieldValueChange, but refresh here too so a panel that is
    // mid-edit still gets consistent `values`.
    values.value = { ...values.value, ...next };
    if (!isEditing.value) text.value = JSON.stringify(values.value, null, 2);
  }

  /**
   * Pushes a rename to the widget in the open document. Fields drawn in Design mode are
   * not in the form plugin's index (it builds that at load time), so this is expected to
   * be a no-op for them — the store remains the source of truth for the download.
   */
  function renameWidget(annotationId: string, name: string): void {
    const active = scope.value;
    if (!active) return;
    try {
      active.renameField(annotationId, name).wait(
        () => refresh(),
        () => undefined,
      );
    } catch (error) {
      console.warn('[form] could not rename the widget in the viewer', error);
    }
  }

  return {
    text,
    parseError,
    fieldCount: computed(() => fields.value.length),
    onInput,
    onFocus,
    onBlur,
    toFieldDTOs,
    setValues,
    getFields: () => fields.value,
    renameWidget,
    refresh,
  };
}
