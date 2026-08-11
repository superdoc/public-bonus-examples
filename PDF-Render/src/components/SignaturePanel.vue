<script setup lang="ts">
/**
 * "My Signatures" — create signatures by drawing, typing or uploading an image, then
 * click one to arm placement. The signature plugin's own tool handles the drop on the
 * page, and AnnotationLayer makes the placed signature draggable and resizable.
 *
 * Both pads call `onResult` continuously while the user works (the type pad fires on
 * every keystroke), so results are held in `draft` and only committed to the entry list
 * when the user presses Save.
 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  SignatureDrawPad,
  SignatureTypePad,
  deserializeEntries,
  serializeEntries,
  useActivePlacement,
  useSignatureCapability,
  useSignatureEntries,
  useSignatureUpload,
  type SignatureEntry,
  type SignatureFieldDefinition,
} from '@embedpdf/plugin-signature/vue';
import { draggingSignatureId, setStatus } from '@/state';

const props = defineProps<{ documentId: string }>();

const STORAGE_KEY = 'pdf-render:signatures';

type Tab = 'draw' | 'type';

const tab = ref<Tab | null>(null);
const draft = ref<SignatureFieldDefinition | null>(null);
const drawPad = ref<InstanceType<typeof SignatureDrawPad> | null>(null);

const { provides: signature } = useSignatureCapability();
const { entries } = useSignatureEntries();
const activePlacement = useActivePlacement(() => props.documentId);

const { openFilePicker, inputRef, handleFileInputChange } = useSignatureUpload({
  onResult: (result) => {
    // A picked file produces exactly one result, so it can be saved straight away.
    if (result) save(result);
  },
});

const armedEntryId = computed(() => activePlacement.value?.entryId ?? null);

function openTab(next: Tab): void {
  tab.value = tab.value === next ? null : next;
  draft.value = null;
}

function save(definition?: SignatureFieldDefinition | null): void {
  const capability = signature.value;
  const toSave = definition ?? draft.value;
  if (!capability || !toSave) return;

  capability.addEntry({ signature: toSave });
  draft.value = null;
  tab.value = null;
  drawPad.value?.clear();
  setStatus('info', 'Signature saved — click it, then click the page to place it.');
}

function removeEntry(entry: SignatureEntry): void {
  signature.value?.removeEntry(entry.id);
}

/**
 * Starts a drag towards the page. The per-page drop zone picks this up; the preview
 * image doubles as the drag image so the cursor carries the signature.
 */
function onDragStart(entry: SignatureEntry, event: DragEvent): void {
  draggingSignatureId.value = entry.id;

  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', entry.id);

  const preview = (event.currentTarget as HTMLElement | null)?.querySelector('img');
  if (preview) {
    event.dataTransfer.setDragImage(preview, preview.clientWidth / 2, preview.clientHeight / 2);
  }
}

function place(entry: SignatureEntry): void {
  const capability = signature.value;
  if (!capability) return;

  const scope = capability.forDocument(props.documentId);
  if (armedEntryId.value === entry.id) {
    scope.deactivatePlacement();
    setStatus('info', 'Placement cancelled.');
    return;
  }
  scope.activateSignaturePlacement(entry.id);
  setStatus('info', 'Now click or drag on the page to drop the signature.');
}

/* ------------------------------------------------------------- persistence ---- */

onMounted(() => {
  const capability = signature.value;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!capability || !raw) return;
  try {
    capability.loadEntries(deserializeEntries(JSON.parse(raw)));
  } catch (error) {
    console.warn('[signatures] could not restore saved signatures', error);
    localStorage.removeItem(STORAGE_KEY);
  }
});

watch(
  () => signature.value,
  (capability, _previous, onCleanup) => {
    if (!capability) return;
    const stop = capability.onEntriesChange((next) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeEntries(next)));
      } catch (error) {
        console.warn('[signatures] could not persist signatures', error);
      }
    });
    onCleanup(stop);
  },
  { immediate: true },
);
</script>

<template>
  <aside class="panel">
    <header>
      <h2 class="panel__title">My Signatures</h2>
      <p class="panel__hint">Create a signature, then drag it onto the page (or click it, then click the page).</p>
    </header>

    <div class="tabs">
      <button class="btn btn--tab" :class="{ 'btn--tab-active': tab === 'draw' }" type="button" @click="openTab('draw')">
        Draw
      </button>
      <button class="btn btn--tab" :class="{ 'btn--tab-active': tab === 'type' }" type="button" @click="openTab('type')">
        Type
      </button>
      <button class="btn btn--tab" type="button" @click="openFilePicker()">Image</button>
    </div>

    <div v-if="tab" class="creator">
      <!-- The pads size themselves to 100% of this box, so the height lives here. -->
      <div class="creator__frame">
        <SignatureDrawPad
          v-if="tab === 'draw'"
          ref="drawPad"
          stroke-color="#1e293b"
          :stroke-width="2.5"
          :on-result="(result) => (draft = result)"
        />
        <SignatureTypePad
          v-else
          color="#1e293b"
          :font-size="44"
          font-family="'Segoe Script', 'Bradley Hand', 'Apple Chancery', cursive"
          placeholder="Type your name"
          :on-result="(result) => (draft = result)"
        />
      </div>

      <div class="creator__actions">
        <span class="creator__note">{{ tab === 'draw' ? 'Draw with the mouse.' : 'Type your name.' }}</span>
        <button v-if="tab === 'draw'" class="btn btn--ghost btn--tiny" type="button" @click="drawPad?.clear(); draft = null">
          Clear
        </button>
        <button class="btn btn--tiny btn--primary" type="button" :disabled="!draft" @click="save()">Save</button>
      </div>
    </div>

    <ul v-if="entries.length" class="entries">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="entry"
        :class="{ 'entry--armed': armedEntryId === entry.id }"
      >
        <button
          class="entry__preview"
          type="button"
          draggable="true"
          :title="
            armedEntryId === entry.id
              ? 'Click to cancel placement'
              : 'Drag onto the page, or click then click the page'
          "
          @click="place(entry)"
          @dragstart="onDragStart(entry, $event)"
          @dragend="draggingSignatureId = null"
        >
          <img :src="entry.signature.previewDataUrl" alt="signature preview" />
        </button>
        <div class="entry__meta">
          <span class="entry__kind">
            {{ armedEntryId === entry.id ? 'Click the page…' : entry.signature.creationType }}
          </span>
          <button class="btn btn--ghost btn--tiny" type="button" @click="removeEntry(entry)">Remove</button>
        </div>
      </li>
    </ul>
    <p v-else class="empty">No signatures yet.</p>

    <input
      ref="inputRef"
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg,image/svg+xml"
      @change="handleFileInputChange"
    />
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 268px;
  flex: none;
  padding: 16px;
  background: #fff;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel__hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--muted);
}

.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.creator {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.creator__frame {
  height: 104px;
  background: #fff;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  touch-action: none;
}

.creator__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.creator__note {
  flex: 1;
  font-size: 10.5px;
  color: var(--muted);
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.entry--armed {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
}

.entry__preview {
  display: block;
  width: 100%;
  padding: 8px;
  border: 0;
  background: #fff;
  cursor: grab;
}

.entry__preview:active {
  cursor: grabbing;
}

.entry__preview img {
  display: block;
  width: 100%;
  height: 52px;
  object-fit: contain;
}

.entry__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
  background: #f8fafc;
}

.entry__kind {
  font-size: 10.5px;
  text-transform: capitalize;
  color: var(--muted);
}

.empty {
  margin: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.hidden-input {
  display: none;
}
</style>
