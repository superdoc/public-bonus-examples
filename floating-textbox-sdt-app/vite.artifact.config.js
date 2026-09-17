import { defineConfig } from 'vite';

// Static build for hosting as a claude.ai Artifact: relative asset URLs, one output folder.
// `vite preview --config vite.artifact.config.js` serves the built folder for a local check.
export default defineConfig({
  base: './',
  build: { outDir: 'dist-artifact', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 20000 },
  preview: { host: 'localhost', port: Number(process.env.PORT) || 4174, strictPort: true },
});
