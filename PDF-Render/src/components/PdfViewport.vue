<script setup lang="ts">
import { computed } from 'vue';
import { DocumentContent } from '@embedpdf/plugin-document-manager/vue';
import { Viewport } from '@embedpdf/plugin-viewport/vue';
import { Scroller } from '@embedpdf/plugin-scroll/vue';
import { RenderLayer } from '@embedpdf/plugin-render/vue';
import { AnnotationLayer } from '@embedpdf/plugin-annotation/vue';
import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/vue';
import { useZoom } from '@embedpdf/plugin-zoom/vue';
import InsertFieldLayer from './InsertFieldLayer.vue';
import SignatureDropZone from './SignatureDropZone.vue';

const props = defineProps<{ documentId: string }>();

const { state: zoomState } = useZoom(() => props.documentId);
const scale = computed(() => zoomState.value.currentZoomLevel ?? 1);
</script>

<template>
  <DocumentContent :document-id="documentId" v-slot="{ isLoading, isError, documentState }">
    <div class="stage">
      <Viewport :document-id="documentId" class="viewport">
        <Scroller :document-id="documentId" v-slot="{ page }">
          <PagePointerProvider
            :document-id="documentId"
            :page-index="page.pageIndex"
            class="page"
            :style="{ width: `${page.width}px`, height: `${page.height}px` }"
          >
            <RenderLayer :document-id="documentId" :page-index="page.pageIndex" class="page__layer" />
            <AnnotationLayer
              :document-id="documentId"
              :page-index="page.pageIndex"
              :resize-ui="{ size: 9, color: '#2563eb' }"
            />
            <InsertFieldLayer :document-id="documentId" :page-index="page.pageIndex" :scale="scale" />
            <SignatureDropZone :document-id="documentId" />
          </PagePointerProvider>
        </Scroller>
      </Viewport>

      <div v-if="isError" class="overlay overlay--error">
        <p class="overlay__title">Could not open this PDF.</p>
        <p class="overlay__detail">{{ documentState?.error ?? 'Unknown error' }}</p>
      </div>
      <div v-else-if="isLoading" class="overlay">Loading document…</div>
    </div>
  </DocumentContent>
</template>

<style scoped>
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  background: #eef1f6;
}

.viewport {
  flex: 1;
  min-height: 0;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #eef1f6;
  color: var(--muted);
  font-size: 13px;
}

.overlay--error {
  color: #b91c1c;
}

.overlay__title {
  margin: 0;
}

.overlay__detail {
  margin: 0;
  font-size: 11.5px;
  color: var(--muted);
}

.page {
  position: relative;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16), 0 8px 24px rgba(15, 23, 42, 0.08);
}

.page__layer {
  position: absolute;
  inset: 0;
}
</style>
