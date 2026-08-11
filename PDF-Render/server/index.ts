/**
 * Single-process server: API + client.
 *
 * In development it mounts Vite in middleware mode so HMR and /api share one port —
 * the same shape the production image runs, which is what Cloud Run expects.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { FlattenRequest } from '../shared/contract.js';
import { flattenPdf } from './flatten.js';
import { ensureSamplePdf } from './make-sample.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
// dev:  <root>/server/index.ts  -> <root>
// prod: <root>/dist/server/index.js -> <root>
const projectRoot = isProd ? path.resolve(here, '../..') : path.resolve(here, '..');
const clientDist = path.join(projectRoot, 'dist/client');
const port = Number(process.env.PORT ?? 8080);

const app = express();
app.disable('x-powered-by');
// A base64 PDF plus signature images; generous but bounded.
app.use(express.json({ limit: '64mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, mode: isProd ? 'production' : 'development' });
});

app.post('/api/flatten', async (req, res) => {
  const body = req.body as FlattenRequest | undefined;

  if (!body?.pdf) {
    res.status(400).json({ error: 'pdf (base64) is required' });
    return;
  }

  try {
    const { bytes, warnings } = await flattenPdf({
      pdf: body.pdf,
      fileName: body.fileName,
      fields: body.fields ?? [],
      designedFields: body.designedFields ?? [],
      placements: body.placements ?? [],
    });

    if (warnings.length > 0) {
      console.warn('[flatten] completed with warnings:', warnings);
      res.setHeader('X-Flatten-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    }

    const downloadName = toDownloadName(body.fileName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.end(Buffer.from(bytes));
  } catch (error) {
    console.error('[flatten] failed:', error);
    res.status(500).json({
      error: 'failed to flatten pdf',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

function toDownloadName(fileName: string | undefined): string {
  const base = (fileName ?? 'document.pdf').replace(/[^\w.\- ]+/g, '_').replace(/\.pdf$/i, '');
  return `${base || 'document'}-filled.pdf`;
}

if (isProd) {
  if (!existsSync(clientDist)) {
    throw new Error(`client bundle missing at ${clientDist} — run "npm run build" first`);
  }
  app.use(express.static(clientDist, { index: false }));
  // SPA fallback. Registered as plain middleware because Express 5's router no longer
  // accepts a bare '*' path pattern.
  app.use((_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  await ensureSamplePdf(path.join(projectRoot, 'public/sample.pdf'));
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${port} (${isProd ? 'production' : 'development'})`);
});
