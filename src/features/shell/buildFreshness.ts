/**
 * B159 — приложение выпускается без подписи и без канала обновлений (решение
 * владельца 2026-08-24), поэтому единственный способ не оставить пилотного
 * пользователя на случайной сборке навсегда — сказать ему об этом самому.
 * Сборка сравнивает свой SHA с тем, что отдаёт `/health` продакшена.
 *
 * Ни один исход не выдумывается: непомеченная сборка и молчащий продакшен —
 * это «неизвестно», а не «всё хорошо».
 */
export type BuildFreshness =
  | { readonly kind: 'current'; readonly releaseSha: string }
  | { readonly kind: 'outdated'; readonly releaseSha: string }
  | {
      readonly kind: 'unknown';
      readonly reason: 'build-unmarked' | 'release-unknown';
    };

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

function normalize(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return SHA_PATTERN.test(trimmed) ? trimmed : null;
}

export function compareBuildToRelease(buildSha: string, releaseSha: string | null): BuildFreshness {
  const build = normalize(buildSha);
  if (!build) return { kind: 'unknown', reason: 'build-unmarked' };

  const release = releaseSha === null ? null : normalize(releaseSha);
  if (!release) return { kind: 'unknown', reason: 'release-unknown' };

  // Сборку помечают коротким SHA, `/health` отдаёт полный: сравниваем по
  // общей длине, иначе одинаковый релиз выглядел бы разным.
  const length = Math.min(build.length, release.length);
  const same = build.slice(0, length) === release.slice(0, length);
  return {
    kind: same ? 'current' : 'outdated',
    releaseSha: release.slice(0, 7),
  };
}

export function buildFreshnessLine(state: BuildFreshness): string {
  if (state.kind === 'current') return 'Сборка совпадает с продакшеном.';
  if (state.kind === 'outdated') {
    return `Эта сборка отстала от продакшена — там уже ${state.releaseSha}. Установите свежую.`;
  }
  return state.reason === 'build-unmarked'
    ? 'Сборка не помечена, поэтому сравнить её с продакшеном нельзя.'
    : 'Свежесть сборки проверить не удалось: продакшен не ответил.';
}
