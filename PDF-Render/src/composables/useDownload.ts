/**
 * Assembles the flatten request and turns the response into a browser download.
 *
 * Only annotations created *in this session* are sent as placements. Annotations that
 * were already in the uploaded file are preserved by pdf-lib on the server, so drawing
 * them again would double them up.
 */
import { onScopeDispose, watch, computed } from 'vue';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue';
import type { FieldValueDTO, FlattenRequest, FlattenWarning, PlacementDTO } from '@shared/contract';
import { designedFields, isDownloading, setStatus, sourcePdf } from '@/state';

export interface UseDownload {
  download: () => Promise<void>;
}

export function useDownload(documentId: () => string, getFields: () => FieldValueDTO[]): UseDownload {
  const { provides: annotationCapability } = useAnnotationCapability();

  /** Ids of stamp/ink annotations this session created. */
  const sessionAnnotationIds = new Set<string>();

  const scope = computed(() => {
    const capability = annotationCapability.value;
    const id = documentId();
    return capability && id ? capability.forDocument(id) : null;
  });

  watch(
    scope,
    (active, _previous, onCleanup) => {
      if (!active) return;
      const stop = active.onAnnotationEvent((event) => {
        if (event.type === 'loaded') return;
        if (!isPlaceable(event.annotation)) return;

        if (event.type === 'create') sessionAnnotationIds.add(event.annotation.id);
        else if (event.type === 'delete') sessionAnnotationIds.delete(event.annotation.id);
      });
      onCleanup(stop);
    },
    { immediate: true },
  );

  onScopeDispose(() => sessionAnnotationIds.clear());

  async function collectPlacements(): Promise<PlacementDTO[]> {
    const active = scope.value;
    if (!active || sessionAnnotationIds.size === 0) return [];

    // Push pending edits into the pdfium document so exported rects are current.
    try {
      await active.commit().toPromise();
    } catch {
      // A no-op commit can reject when there is nothing pending; export still works.
    }

    const exported = await active.exportAnnotations().toPromise();
    const placements: PlacementDTO[] = [];

    for (const item of exported) {
      const annotation = item.annotation;
      if (!sessionAnnotationIds.has(annotation.id)) continue;

      if (annotation.type === PdfAnnotationSubtype.STAMP) {
        const ctx = item.ctx as { data?: ArrayBuffer; mimeType?: string } | undefined;
        if (!ctx?.data) continue;
        placements.push({
          kind: 'stamp',
          pageIndex: annotation.pageIndex,
          rect: annotation.rect,
          imageBase64: bytesToBase64(new Uint8Array(ctx.data)),
          mimeType: ctx.mimeType ?? 'image/png',
        });
        continue;
      }

      if (annotation.type === PdfAnnotationSubtype.INK) {
        placements.push({
          kind: 'ink',
          pageIndex: annotation.pageIndex,
          rect: annotation.rect,
          inkList: annotation.inkList.map((stroke) => ({
            points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
          })),
          strokeColor: annotation.strokeColor ?? '#1e293b',
          strokeWidth: annotation.strokeWidth ?? 2,
        });
      }
    }

    return placements;
  }

  async function download(): Promise<void> {
    const source = sourcePdf.value;
    if (!source) {
      setStatus('error', 'No PDF loaded yet.');
      return;
    }
    if (isDownloading.value) return;

    isDownloading.value = true;
    setStatus('info', 'Flattening on the server…');

    try {
      const request: FlattenRequest = {
        pdf: bytesToBase64(source.bytes),
        fileName: source.name,
        fields: getFields(),
        // `annotationId` is a client-side handle for renames; keep it out of the wire.
        designedFields: designedFields.value.map(({ annotationId, ...field }) => {
          void annotationId;
          return field;
        }),
        placements: await collectPlacements(),
      };

      const response = await fetch('/api/flatten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`server responded ${response.status}: ${detail.slice(0, 300)}`);
      }

      const warnings = readWarnings(response.headers.get('X-Flatten-Warnings'));
      const blob = await response.blob();
      triggerDownload(blob, fileNameFrom(response.headers.get('Content-Disposition'), source.name));

      if (warnings.length > 0) {
        console.warn('[flatten] warnings', warnings);
        setStatus('info', `Downloaded with ${warnings.length} warning(s) — see console.`);
      } else {
        setStatus('success', 'Flattened PDF downloaded.');
      }
    } catch (error) {
      console.error('[flatten] failed', error);
      setStatus('error', error instanceof Error ? error.message : 'Download failed.');
    } finally {
      isDownloading.value = false;
    }
  }

  return { download };
}

/** Stamp and ink are the two subtypes the signature plugin produces. */
function isPlaceable(
  annotation: PdfAnnotationObject,
): annotation is Extract<PdfAnnotationObject, { type: PdfAnnotationSubtype.STAMP | PdfAnnotationSubtype.INK }> {
  return annotation.type === PdfAnnotationSubtype.STAMP || annotation.type === PdfAnnotationSubtype.INK;
}

function readWarnings(header: string | null): FlattenWarning[] {
  if (!header) return [];
  try {
    return JSON.parse(decodeURIComponent(header)) as FlattenWarning[];
  } catch {
    return [];
  }
}

function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="?([^"]+)"?/.exec(disposition) : null;
  return match?.[1] ?? fallback.replace(/\.pdf$/i, '') + '-filled.pdf';
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Chunked so a multi-megabyte PDF doesn't blow the argument limit of String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
