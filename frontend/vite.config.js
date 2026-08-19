import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'manpower-estate-badland.ngrok-free.dev',
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '700a-103-29-157-82.ngrok-free.app',
      'localhost',
      '127.0.0.1',
    ],
    proxy: {
      '/api': {
        target: 'https://700a-103-29-157-82.ngrok-free.app',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('ngrok-skip-browser-warning', '69420');
          });
        },
      },
    },
  },
});
