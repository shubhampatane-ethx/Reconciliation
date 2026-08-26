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
      // Falls back to your local backend by default. Override by setting
      // VITE_BACKEND_PROXY_TARGET in your .env if you're tunneling through
      // ngrok/cloudflare instead of running the backend locally. This proxy
      // is only used when the frontend calls relative "/api/..." paths;
      // if VITE_API_BASE_URL is set (see .env.example), axios calls the
      // backend directly and this proxy is bypassed entirely.
      '/api': {
        target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:5000'||'https://0b1f-103-248-74-131.ngrok-free.app',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('ngrok-skip-browser-warning', '69420');
          });
          proxy.on('error', (err) => {
            console.error('[vite proxy] Could not reach backend at', process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:5000', '-', err.message);
          });
        },
      },
    },
  },
});