import { defineConfig } from 'vite';
import { attachRelay } from './server/relay.js';

export default defineConfig({
  base: '/suppression/',
  plugins: [{ name: 'multiplayer-relay', configureServer(server) { if (server.httpServer) attachRelay(server.httpServer); }, configurePreviewServer(server) { attachRelay(server.httpServer); } }],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
});
