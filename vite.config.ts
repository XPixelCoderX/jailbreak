import { defineConfig, type Plugin } from 'vite';
import { attachRelay } from './server/relay.js';

const multiplayerRelay: Plugin = {
  name: 'multiplayer-relay',

  configureServer(server) {
    if (server.httpServer) {
      attachRelay(server.httpServer);
    }
  },

  configurePreviewServer(server) {
    attachRelay(server.httpServer);
  },
};

export default defineConfig({
  base: '/',

  plugins: [
    multiplayerRelay,
  ],

  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
