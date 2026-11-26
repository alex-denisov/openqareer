/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { logicalVarToPhysical } from './scripts/vite/logicalVarToPhysical.ts';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    __APP_COMMIT__: JSON.stringify(process.env.OPENQAREER_COMMIT_SHA ?? ''),
    __APP_BUILD_DATE__: JSON.stringify(process.env.OPENQAREER_BUILD_DATE ?? new Date().toISOString()),
  },
  plugins: [react()],
  // B640 в окне .app: логические сокращения с var() → физические стороны (см. плагин).
  css: { postcss: { plugins: [logicalVarToPhysical()] } },
  build: { manifest: true },
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
