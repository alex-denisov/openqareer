import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testMaintenanceImport } from './accept-maintenance-import.mjs';

describe('accept-maintenance-import (B323)', () => {
  it('возвращает код 0 на чистом файле без внешних зависимостей', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'oq-clean-fixture-'));
    try {
      const cleanFile = join(fixtureDir, 'maintenance.mjs');
      writeFileSync(cleanFile, 'export const status = "clean";');

      const result = await testMaintenanceImport(fixtureDir);
      expect(result.success).toBe(true);
      expect(result.code).toBe(0);
      expect(result.error).toBeUndefined();
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('возвращает код 1 при импорте отсутствующего внешнего пакета', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'oq-broken-fixture-'));
    try {
      const brokenFile = join(fixtureDir, 'maintenance.mjs');
      writeFileSync(brokenFile, 'import "non_existent_unbundled_package_xyz";');

      const result = await testMaintenanceImport(fixtureDir);
      expect(result.success).toBe(false);
      expect(result.code).toBe(1);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
