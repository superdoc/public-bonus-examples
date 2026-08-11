<script setup lang="ts">
/**
 * Per-page drop target for dragging a signature out of the left panel and onto the page.
 *
 * The overlay only exists while a drag is in progress, so it never interferes with
 * filling or selecting the rest of the time.
 *
 * On drop it hands off to the signature plugin's own placement tool rather than creating
 * an annotation directly: `activateSignaturePlacement()` arms the tool, and the tool's
 * handler commits the annotation centred on the next `pointerdown` it receives. So the
 * drop arms it, hides the overlay, and synthesises that one pointer event at the drop
 * point — which keeps stamp-vs-ink handling, sizing and history in the plugin.
 */
import { computed, nextTick } from 'vue';
import { useSignatureCapability } from '@embedpdf/plugin-signature/vue';
import { draggingSignatureId, setStatus } from '@/state';

const props = defineProps<{ documentId: string }>();

const { provides: signature } = useSignatureCapability();

const isDragging = computed(() => draggingSignatureId.value !== null);

async function onDrop(event: DragEvent): Promise<void> {
  const entryId = draggingSignatureId.value ?? event.dataTransfer?.getData('text/plain');
  const { clientX, clientY } = event;

  draggingSignatureId.value = null;
  if (!entryId) return;

  const capability = signature.value;
  if (!capability) return;

  capability.forDocument(props.documentId).activateSignaturePlacement(entryId);

  // Let the overlay unmount and the tool become active before locating the element under
  // the cursor — with an armed tool that is the interaction manager's own page overlay.
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const target = document.elementFromPoint(clientX, clientY);
  if (!target) return;

  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  };

  // A move first so the tool has a position for its ghost, then the down that commits.
  target.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 0 }));
  target.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));

  setStatus('success', 'Signature placed — drag it to fine-tune.');
}
</script>

<template>
  <div
    v-if="isDragging"
    class="dropzone"
    @dragenter.prevent
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <span class="dropzone__hint">Drop to place</span>
  </div>
</template>

<style scoped>
.dropzone {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  border: 2px dashed var(--accent);
  background: rgba(37, 99, 235, 0.06);
  border-radius: 2px;
}

.dropzone__hint {
  margin-top: 8px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  pointer-events: none;
}
</style>
