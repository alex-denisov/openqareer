import { describe, expect, it } from 'vitest';
import { buildFreshnessLine, compareBuildToRelease } from './buildFreshness';

describe('B159 — сборка честно говорит, отстала ли она от продакшена', () => {
  it('называет сборку текущей, когда она совпадает с релизом', () => {
    const state = compareBuildToRelease(
      'ce62d39aa1b2c3d4e5f60718293a4b5c6d7e8f90',
      'ce62d39aa1b2c3d4e5f60718293a4b5c6d7e8f90',
    );
    expect(state).toEqual({ kind: 'current', releaseSha: 'ce62d39' });
    expect(buildFreshnessLine(state)).toBe('Сборка совпадает с продакшеном.');
  });

  it('сравнивает по короткому SHA, если сборка помечена коротким', () => {
    expect(compareBuildToRelease('ce62d39', 'ce62d39aa1b2c3d4e5f60718293a4b5c6d7e8f90')).toEqual({
      kind: 'current',
      releaseSha: 'ce62d39',
    });
  });

  it('говорит об отставании и называет сборку продакшена', () => {
    const state = compareBuildToRelease(
      '6203269aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '89c3824d707d4eac002eb5779af62237ebea67e5',
    );
    expect(state).toEqual({ kind: 'outdated', releaseSha: '89c3824' });
    expect(buildFreshnessLine(state)).toBe(
      'Эта сборка отстала от продакшена — там уже 89c3824. Установите свежую.',
    );
  });

  it('не выдумывает ответ, когда сборка не помечена', () => {
    const state = compareBuildToRelease('', '89c3824d707d4eac002eb5779af62237ebea67e5');
    expect(state).toEqual({ kind: 'unknown', reason: 'build-unmarked' });
    expect(buildFreshnessLine(state)).toBe(
      'Сборка не помечена, поэтому сравнить её с продакшеном нельзя.',
    );
  });

  it('не выдумывает ответ, когда продакшен не ответил', () => {
    const state = compareBuildToRelease('6203269', null);
    expect(state).toEqual({ kind: 'unknown', reason: 'release-unknown' });
    expect(buildFreshnessLine(state)).toBe(
      'Свежесть сборки проверить не удалось: продакшен не ответил.',
    );
  });

  it('не принимает за релиз ответ, который не похож на SHA', () => {
    expect(compareBuildToRelease('6203269', 'ok')).toEqual({
      kind: 'unknown',
      reason: 'release-unknown',
    });
  });
});
