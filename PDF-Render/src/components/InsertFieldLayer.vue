<script setup lang="ts">
/**
 * Design-mode overlay for one page. Two jobs:
 *
 *  1. When an insert tool is armed, rubber-band a rect and create a real WIDGET
 *     annotation from it (`EPDFPage_CreateFormField` under the hood), recording it in
 *     the store so the server can recreate the same field with pdf-lib.
 *  2. Preview designed image fields, which the viewer renders as bare push buttons.
 *
 * Pointer positions arrive from PagePointerProvider already in PDF points with a
 * top-left origin — the same space annotation rects use — so nothing is converted here.
 * Only the CSS preview is multiplied by the zoom scale.
 */
import { computed, ref, watch } from 'vue';
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  PdfStandardFont,
  uuidV4,
  type Position,
  type Rect,
} from '@embedpdf/models';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue';
import {
  useInteractionManager,
  useInteractionManagerCapability,
  usePointerHandlers,
  type PointerEventHandlers,
} from '@embedpdf/plugin-interaction-manager/vue';
import { INSERT_FIELD_MODE } from '@/plugins';
import { addDesignedField, armedField, designedFields, nextFieldName, setStatus } from '@/state';

const props = defineProps<{
  documentId: string;
  pageIndex: number;
  /** Current zoom factor, used only to scale the CSS preview. */
  scale: number;
}>();

const MIN_SIZE = 12;

const { provides: annotationCapability } = useAnnotationCapability();
const { provides: interactionCapability } = useInteractionManagerCapability();
const interaction = useInteractionManager(() => props.documentId);

// The mode has to exist before it can be activated, and `exclusive` puts a transparent
// overlay on the page so the drag is not intercepted by widgets or annotations below.
watch(
  interactionCapability,
  (capability) => {
    capability?.registerMode({
      id: INSERT_FIELD_MODE,
      scope: 'page',
      exclusive: true,
      cursor: 'crosshair',
    });
  },
  { immediate: true },
);
const { register } = usePointerHandlers({
  documentId: () => props.documentId,
  pageIndex: () => props.pageIndex,
  modeId: INSERT_FIELD_MODE,
});

const dragStart = ref<Position | null>(null);
const dragCurrent = ref<Position | null>(null);

/** Rubber-band rect in page points, normalised so dragging any direction works. */
const draftRect = computed<Rect | null>(() => {
  const start = dragStart.value;
  const current = dragCurrent.value;
  if (!start || !current) return null;
  return {
    origin: { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) },
    size: { width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) },
  };
});

const imagePreviews = computed(() =>
  designedFields.value.filter(
    (field) => field.pageIndex === props.pageIndex && field.kind === 'image' && field.imageBase64,
  ),
);

// Activate our interaction mode only while a tool is armed, so normal selection keeps
// working the rest of the time.
watch(
  [() => armedField.value?.kind, () => interaction.provides.value],
  ([kind, scope]) => {
    if (!scope) return;
    if (kind) scope.activate(INSERT_FIELD_MODE);
    else if (scope.getActiveMode() === INSERT_FIELD_MODE) scope.activateDefaultMode();
  },
  { immediate: true },
);

const pointerHandlers: PointerEventHandlers = {
  onPointerDown: (position) => {
    if (!armedField.value) return;
    dragStart.value = position;
    dragCurrent.value = position;
  },
  onPointerMove: (position) => {
    if (!dragStart.value) return;
    dragCurrent.value = position;
  },
  onPointerUp: () => {
    const rect = draftRect.value;
    const armed = armedField.value;
    dragStart.value = null;
    dragCurrent.value = null;

    if (!rect || !armed) return;
    if (rect.size.width < MIN_SIZE || rect.size.height < MIN_SIZE) {
      setStatus('info', 'That area was too small — drag a larger rectangle.');
      return;
    }

    createField(rect, armed.kind, armed.imageBase64, armed.imageMimeType);
    armedField.value = null;
  },
};

// `register` is a one-shot imperative call that silently does nothing when the
// capability has not resolved yet, so it has to run from a watch rather than straight
// from setup — and re-run if the document or page changes.
watch(
  [interactionCapability, () => props.documentId, () => props.pageIndex],
  (_current, _previous, onCleanup) => {
    const unregister = register(pointerHandlers);
    if (unregister) onCleanup(unregister);
  },
  { immediate: true },
);

function createField(
  rect: Rect,
  kind: 'text' | 'checkbox' | 'image',
  imageBase64?: string,
  imageMimeType?: string,
): void {
  const capability = annotationCapability.value;
  if (!capability) return;

  const name = nextFieldName(kind);
  const fieldType =
    kind === 'text'
      ? PDF_FORM_FIELD_TYPE.TEXTFIELD
      : kind === 'checkbox'
        ? PDF_FORM_FIELD_TYPE.CHECKBOX
        : // AcroForm has no image field; a push button carrying an image appearance is
          // the standard equivalent, and matches pdf-lib's PDFButton.setImage().
          PDF_FORM_FIELD_TYPE.PUSHBUTTON;

  const scope = capability.forDocument(props.documentId);
  const annotationId = uuidV4();

  try {
    scope.createAnnotation(props.pageIndex, {
      type: PdfAnnotationSubtype.WIDGET,
      id: annotationId,
      pageIndex: props.pageIndex,
      rect,
      field: {
        type: fieldType,
        name,
        alternateName: name.replace(/_/g, ' '),
        value: '',
        flag: 0,
      },
      fontFamily: PdfStandardFont.Helvetica,
      fontSize: 11,
      fontColor: '#111827',
      strokeWidth: 1,
      strokeColor: '#94a3b8',
      color: 'transparent',
    } as never);
    scope.commit();
  } catch (error) {
    // The field still reaches the downloaded PDF via the store, so this is not fatal.
    console.warn('[insertField] viewer could not create the widget', error);
  }

  addDesignedField({
    name,
    kind,
    pageIndex: props.pageIndex,
    rect: { origin: { ...rect.origin }, size: { ...rect.size } },
    imageBase64,
    imageMimeType,
    annotationId,
  });

  setStatus('success', `Added ${kind} field "${name}".`);
}

function toCssRect(rect: Rect): Record<string, string> {
  return {
    left: `${rect.origin.x * props.scale}px`,
    top: `${rect.origin.y * props.scale}px`,
    width: `${rect.size.width * props.scale}px`,
    height: `${rect.size.height * props.scale}px`,
  };
}
</script>

<template>
  <div class="insert-layer" :class="{ 'insert-layer--armed': !!armedField }">
    <img
      v-for="field in imagePreviews"
      :key="field.name"
      class="insert-layer__image"
      :style="toCssRect(field.rect)"
      :src="`data:${field.imageMimeType ?? 'image/png'};base64,${field.imageBase64}`"
      :alt="field.name"
    />
    <div v-if="draftRect" class="insert-layer__draft" :style="toCssRect(draftRect)"></div>
  </div>
</template>

<style scoped>
.insert-layer {
  position: absolute;
  inset: 0;
  /* Transparent to pointer events unless a tool is armed; PagePointerProvider's own
     overlay handles the events for our exclusive mode. */
  pointer-events: none;
  z-index: 6;
}

.insert-layer--armed {
  cursor: crosshair;
}

.insert-layer__draft {
  position: absolute;
  border: 1.5px dashed #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-radius: 2px;
}

.insert-layer__image {
  position: absolute;
  object-fit: contain;
}
</style>
