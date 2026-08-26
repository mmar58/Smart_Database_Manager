import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all REST API calls to the Express backend
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy socket.io WebSocket traffic
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      // Proxy other backend routes
      '/store-credentials': 'http://localhost:3000',
      '/session-credentials': 'http://localhost:3000',
      '/logout': 'http://localhost:3000',
      '/backups': 'http://localhost:3000',
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../backend/src/public'),
    emptyOutDir: true,
  },
});
