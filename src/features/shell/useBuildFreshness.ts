import { useEffect, useState } from 'react';
import type { BuildFreshness } from './buildFreshness';
import { compareBuildToRelease } from './buildFreshness';
import { readReleaseSha } from './releaseSha';

/**
 * B159 — пока проверка идёт, интерфейс не утверждает ничего: `null` означает
 * «ещё не знаем», а не «сборка свежая».
 */
export function useBuildFreshness(buildSha: string): BuildFreshness | null {
  const [state, setState] = useState<BuildFreshness | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readReleaseSha().then((releaseSha) => {
      if (!cancelled) setState(compareBuildToRelease(buildSha, releaseSha));
    });
    return () => {
      cancelled = true;
    };
  }, [buildSha]);

  return state;
}
