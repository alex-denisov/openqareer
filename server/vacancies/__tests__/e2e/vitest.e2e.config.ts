import { defineConfig } from 'vitest/config';
import { timeBudget } from '../../../../shared/testing/timeBudget.ts';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    __APP_COMMIT__: JSON.stringify(process.env.OPENQAREER_COMMIT_SHA ?? ''),
    __APP_BUILD_DATE__: JSON.stringify(process.env.OPENQAREER_BUILD_DATE ?? new Date().toISOString()),
  },
  test: {
    testTimeout: timeBudget(30_000),
    include: ['server/vacancies/__tests__/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
