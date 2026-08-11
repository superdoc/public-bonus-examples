<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAnnotation, LockModeType } from '@embedpdf/plugin-annotation/vue';
import { useZoom } from '@embedpdf/plugin-zoom/vue';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/vue';
import type { DesignedFieldKind } from '@shared/contract';
import { DESIGN_MODE_LOCK, FILL_MODE_LOCK } from '@/plugins';
import { armedField, isDownloading, setSourcePdf, setStatus } from '@/state';
import { bytesToBase64 } from '@/composables/useDownload';

const props = defineProps<{ documentId: string }>();

const emit = defineEmits<{
  download: [];
  autoFill: [];
  clearForm: [];
}>();

const annotation = useAnnotation(() => props.documentId);
const { provides: zoom, state: zoomState } = useZoom(() => props.documentId);
const { provides: documentManager } = useDocumentManagerCapability();

const pdfInput = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);

const INSERT_KINDS: DesignedFieldKind[] = ['text', 'checkbox', 'image'];

const fillMode = computed(() => {
  const locked = annotation.state.value.locked;
  return locked.type === LockModeType.Include && locked.categories?.includes('form');
});

const zoomPercent = computed(() => Math.round((zoomState.value.currentZoomLevel ?? 1) * 100));

function toggleMode(): void {
  const goingToDesign = fillMode.value;
  annotation.provides.value?.setLocked(goingToDesign ? DESIGN_MODE_LOCK : FILL_MODE_LOCK);
  // Leaving Design mode disarms any half-started insert tool.
  if (!goingToDesign) armedField.value = null;
}

/* ------------------------------------------------------------------ upload ---- */

async function onPdfChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const buffer = await file.arrayBuffer();
  // openDocumentBuffer hands the buffer to the pdfium worker, which detaches it. Keep
  // our own copy first — it is the source the server flattens.
  setSourcePdf({ bytes: new Uint8Array(buffer.slice(0)), name: file.name });

  const manager = documentManager.value;
  if (!manager) return;

  try {
    const opened = await manager.openDocumentBuffer({ buffer, name: file.name }).toPromise();
    await opened.task.toPromise();
    setStatus('success', `Loaded ${file.name}`);
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Could not open that PDF.');
  }
}

/* -------------------------------------------------------------- insert tool ---- */

function armField(kind: DesignedFieldKind): void {
  if (armedField.value?.kind === kind) {
    armedField.value = null;
    setStatus('info', 'Insert tool disarmed.');
    return;
  }

  if (kind === 'image') {
    // Pick the picture first, then arm — the drawn rect becomes its appearance.
    imageInput.value?.click();
    return;
  }

  armedField.value = { kind };
  setStatus('info', `Drag on the page to place a ${kind} field.`);
}

async function onFieldImageChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const bytes = new Uint8Array(await file.arrayBuffer());
  armedField.value = {
    kind: 'image',
    imageBase64: bytesToBase64(bytes),
    imageMimeType: file.type || 'image/png',
  };
  setStatus('info', 'Drag on the page to place the image field.');
}
</script>

<template>
  <div class="toolbar">
    <span class="mode-badge" :class="{ 'mode-badge--design': !fillMode }">
      {{ fillMode ? 'Fill Mode' : 'Design Mode' }}
    </span>

    <button class="btn btn--accent" type="button" @click="emit('autoFill')">Auto Fill Data</button>
    <button class="btn" type="button" @click="emit('clearForm')">Clear Form</button>
    <button class="btn btn--outline" type="button" @click="pdfInput?.click()">Upload</button>

    <div class="zoom">
      <button class="btn btn--icon" type="button" title="Zoom out" @click="zoom?.zoomOut()">&minus;</button>
      <span class="zoom__value">{{ zoomPercent }}%</span>
      <button class="btn btn--icon" type="button" title="Zoom in" @click="zoom?.zoomIn()">+</button>
    </div>

    <button class="btn btn--accent" type="button" @click="toggleMode">
      Switch to {{ fillMode ? 'Design' : 'Fill' }} Mode
    </button>

    <div v-if="!fillMode" class="insert-group">
      <span class="insert-group__label">Insert</span>
      <button
        v-for="kind in INSERT_KINDS"
        :key="kind"
        class="btn btn--chip"
        :class="{ 'btn--chip-active': armedField?.kind === kind }"
        type="button"
        @click="armField(kind)"
      >
        {{ kind }}
      </button>
    </div>

    <button
      class="btn btn--primary btn--download"
      type="button"
      :disabled="isDownloading"
      @click="emit('download')"
    >
      {{ isDownloading ? 'Preparing…' : 'Download PDF' }}
    </button>

    <input ref="pdfInput" class="hidden-input" type="file" accept="application/pdf" @change="onPdfChosen" />
    <input
      ref="imageInput"
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg"
      @change="onFieldImageChosen"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}

.mode-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}

.mode-badge--design {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 2px;
}

.zoom__value {
  font-size: 12px;
  color: var(--muted);
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.insert-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}

.insert-group__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.btn--download {
  margin-left: auto;
}

.hidden-input {
  display: none;
}
</style>
