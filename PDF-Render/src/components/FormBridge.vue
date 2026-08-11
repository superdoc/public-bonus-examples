<script setup lang="ts">
/**
 * Renderless bridge. `useFormJson` and `useDownload` need the plugin context that
 * <EmbedPDF> provides, so they cannot live in App.vue's setup — this component sits
 * inside the provider and hands the results down through a scoped slot.
 */
import { useFormJson, type UseFormJson } from '@/composables/useFormJson';
import { useDownload } from '@/composables/useDownload';
import { buildAutoFillValues, buildClearValues } from '@/autofill';

const props = defineProps<{ documentId: string }>();

const json = useFormJson(() => props.documentId);
const { download } = useDownload(
  () => props.documentId,
  () => json.toFieldDTOs(),
);

function autoFill(): void {
  json.setValues(buildAutoFillValues(json.getFields()));
}

function clearForm(): void {
  json.setValues(buildClearValues(json.getFields()));
}

export interface FormApi {
  json: UseFormJson;
  autoFill: () => void;
  clearForm: () => void;
}

defineSlots<{
  default(props: { form: FormApi; download: () => Promise<void> }): unknown;
}>();
</script>

<template>
  <slot :form="{ json, autoFill, clearForm }" :download="download" />
</template>
