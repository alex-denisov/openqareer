import { describe, expect, it } from 'vitest';
import { appBuildLine } from './appBuild';

describe('appBuildLine', () => {
  it('версия, короткий номер сборки и дата сборки по Москве', () => {
    expect(appBuildLine('1.1.0', 'a1b2c3d4e5f6a7b8', '2026-11-19T21:30:00.000Z')).toBe('Версия 1.1.0 · сборка a1b2c3d · 20 ноября 2026');
  });

  it('непомеченная сборка — только версия и дата; без даты — без неё', () => {
    expect(appBuildLine('1.1.0', '', '2026-11-19T08:00:00.000Z')).toBe('Версия 1.1.0 · 19 ноября 2026');
    expect(appBuildLine('1.1.0', 'not-a-sha', '')).toBe('Версия 1.1.0');
    expect(appBuildLine('1.1.0', 'abcdef1', 'вчера')).toBe('Версия 1.1.0 · сборка abcdef1');
  });
});
