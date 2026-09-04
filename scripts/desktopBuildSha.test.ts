import { describe, expect, it } from 'vitest';
// @ts-expect-error — сборочный скрипт живёт в JS, у него нет типов
import { desktopBuildSha } from './desktopBuildSha.mjs';

describe('B159 — метка десктопной сборки', () => {
  const head = '50e5b2f0a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('помечает сборку из чистого дерева коммитом HEAD', () => {
    expect(desktopBuildSha(head, '')).toEqual({ sha: head, reason: 'head' });
  });

  it('не помечает сборку из изменённого дерева чужим коммитом', () => {
    expect(desktopBuildSha(head, ' M src/App.tsx\n')).toEqual({
      sha: '',
      reason: 'dirty-tree',
    });
  });

  it('не выдумывает метку, когда git не назвал HEAD', () => {
    expect(desktopBuildSha('', '')).toEqual({ sha: '', reason: 'no-head' });
    expect(desktopBuildSha('не-sha', '')).toEqual({ sha: '', reason: 'no-head' });
  });
});
