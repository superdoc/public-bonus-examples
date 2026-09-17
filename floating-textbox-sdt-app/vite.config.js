import { defineConfig } from 'vite';

// The preview tool assigns a port through the PORT environment variable.
export default defineConfig({
  server: {
    host: 'localhost',
    port: Number(process.env.PORT) || 5174,
    strictPort: true,
  },
});
