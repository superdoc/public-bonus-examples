import { createPluginRegistration } from '@embedpdf/core';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/vue';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/vue';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll/vue';
import { RenderPluginPackage } from '@embedpdf/plugin-render/vue';
import { ZoomPluginPackage, ZoomMode } from '@embedpdf/plugin-zoom/vue';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/vue';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/vue';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/vue';
import { AnnotationPluginPackage, LockModeType, type LockMode } from '@embedpdf/plugin-annotation/vue';
import { FormPluginPackage } from '@embedpdf/plugin-form/vue';
import { SignaturePluginPackage, SignatureMode } from '@embedpdf/plugin-signature/vue';

export const SAMPLE_PDF_URL = '/sample.pdf';

/** Interaction mode id for the "drag out a new form field" tool. */
export const INSERT_FIELD_MODE = 'insertFormField';

/**
 * Fill mode locks the `form` annotation category: clicks fall through the annotation
 * layer to the form widgets, so fields are fillable but not movable. Design mode
 * unlocks everything, making the widgets selectable/draggable instead.
 */
export const FILL_MODE_LOCK: LockMode = {
  type: LockModeType.Include,
  categories: ['form'],
};

export const DESIGN_MODE_LOCK: LockMode = { type: LockModeType.None };

/**
 * Registration order matters: the annotation plugin's dependencies come first, then
 * annotation itself, then the plugins that build on it (form, signature).
 */
export function createPlugins() {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: [{ url: SAMPLE_PDF_URL }],
    }),
    createPluginRegistration(ViewportPluginPackage),
    createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: ZoomMode.FitPage,
      minZoom: 0.25,
      maxZoom: 6,
    }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      locked: FILL_MODE_LOCK,
    }),
    createPluginRegistration(FormPluginPackage),
    createPluginRegistration(SignaturePluginPackage, {
      mode: SignatureMode.SignatureOnly,
      defaultSize: { width: 180, height: 60 },
    }),
  ];
}
