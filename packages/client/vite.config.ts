import { defineConfig } from 'vite';

const server = process.env.NESTHOLD_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  base: './',
  server: {
    host: true,
    proxy: {
      '/api': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
