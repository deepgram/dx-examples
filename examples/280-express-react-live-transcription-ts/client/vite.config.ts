import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/listen': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/health': {
        target: 'http://localhost:3000',
      },
    },
  },
});
