import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on all interfaces (needed for tunnels / LAN access)
    allowedHosts: true, // accept any Host header (e.g. *.trycloudflare.com, *.loca.lt)
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: true,
  },
});
