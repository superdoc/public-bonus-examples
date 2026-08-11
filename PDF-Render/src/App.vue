<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { EmbedPDF } from '@embedpdf/core/vue';
import { usePdfiumEngine } from '@embedpdf/engines/vue';
// Serve the pdfium WASM from our own origin. The default is a jsDelivr URL, which would
// make the container depend on the public internet at runtime.
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { createPlugins, SAMPLE_PDF_URL } from '@/plugins';
import { setSourcePdf, setStatus, statusMessage, clearStatus } from '@/state';
import Toolbar from '@/components/Toolbar.vue';
import PdfViewport from '@/components/PdfViewport.vue';
import SignaturePanel from '@/components/SignaturePanel.vue';
import JsonPanel from '@/components/JsonPanel.vue';
import FormBridge from '@/components/FormBridge.vue';

// The engine runs in a worker created from a `blob:` URL, and relative URLs cannot be
// resolved against a blob base — so the WASM location has to be absolute. Vite gives us
// a root-relative path in both dev and prod, hence the explicit resolve.
const wasmUrl = new URL(pdfiumWasmUrl, window.location.href).href;

// `fontFallback: null` keeps the engine from fetching substitute fonts off-origin.
const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl, fontFallback: null });

const plugins = shallowRef(createPlugins());


// The viewer loads the sample from a URL; we need the same bytes for the server round
// trip, because the pdfium copy cannot be read back out.
onMounted(async () => {
  try {
    const response = await fetch(SAMPLE_PDF_URL);
    if (!response.ok) throw new Error(`sample.pdf responded ${response.status}`);
    setSourcePdf({ bytes: new Uint8Array(await response.arrayBuffer()), name: 'sample.pdf' });
  } catch (cause) {
    console.warn('[app] sample.pdf unavailable', cause);
    setStatus('error', 'Could not load sample.pdf — upload a PDF to continue.');
  }
});
</script>

<template>
  <div class="app">
    <div v-if="error" class="fallback fallback--error">
      <h1>The PDF engine failed to load</h1>
      <p>{{ error.message }}</p>
    </div>

    <div v-else-if="isLoading || !engine" class="fallback">
      <div class="spinner" aria-hidden="true"></div>
      <p>Loading PDF engine…</p>
    </div>

    <EmbedPDF v-else :engine="engine" :plugins="plugins" v-slot="{ activeDocumentId }">
      <FormBridge v-if="activeDocumentId" :key="activeDocumentId" :document-id="activeDocumentId" v-slot="{ form, download }">
        <div class="layout">
          <SignaturePanel :document-id="activeDocumentId" />

          <main class="center">
            <Toolbar
              :document-id="activeDocumentId"
              @download="download"
              @auto-fill="form.autoFill()"
              @clear-form="form.clearForm()"
            />
            <PdfViewport :document-id="activeDocumentId" />
          </main>

          <JsonPanel :form="form.json" />
        </div>
      </FormBridge>

      <div v-else class="fallback">
        <div class="spinner" aria-hidden="true"></div>
        <p>Opening document…</p>
      </div>
    </EmbedPDF>

    <Transition name="toast">
      <button
        v-if="statusMessage"
        class="toast"
        :class="`toast--${statusMessage.tone}`"
        type="button"
        title="Dismiss"
        @click="clearStatus()"
      >
        {{ statusMessage.text }}
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.layout {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.fallback {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
  font-size: 13px;
}

.fallback--error {
  color: #b91c1c;
}

.fallback h1 {
  margin: 0;
  font-size: 16px;
}

.spinner {
  width: 26px;
  height: 26px;
  border: 2.5px solid #dbe2ea;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 32px));
  padding: 9px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #0f172a;
  color: #fff;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
}

.toast--error {
  background: #b91c1c;
  border-color: #b91c1c;
}

.toast--success {
  background: #047857;
  border-color: #047857;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
