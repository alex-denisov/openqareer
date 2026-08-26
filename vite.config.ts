/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __APP_COMMIT__: JSON.stringify(process.env.OPENQAREER_COMMIT_SHA ?? ''),
  },
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/api': 'http://127.0.0.1:3210',
      '/health': 'http://127.0.0.1:3210',
    },
  },
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

