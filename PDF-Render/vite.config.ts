import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  // The pdfium engine is loaded in a web worker; it must be bundled as an ES module.
  worker: { format: 'es' },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
