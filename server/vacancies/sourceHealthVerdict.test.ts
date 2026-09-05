import { describe, expect, it } from 'vitest';
import {
  censusOfReading,
  describeSourceHealth,
  emptySourceObservations,
  recordReading,
  type SourceObservations,
} from './sourceHealthVerdict';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * B200 срез 1. Живость и доверие — две разные шкалы, посчитанные из наблюдений
 * опроса. Проверки написаны по спецификациям тикета до кода.
 */

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function card(overrides: Partial<UnifiedVacancy> = {}): UnifiedVacancy {
  const id = overrides.id ?? 'v1';
  return {
    id,
    fingerprint: id,
    title: 'Инженер',
    company: 'Настоящий работодатель',
    description: 'Описание',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'rss',
      sourceId: 'src-test',
      sourceUrl: `https://example.test/${id}`,
      observedAt: daysAgo(0),
    },
    publishedAt: daysAgo(1),
    status: 'active',
    ...overrides,
  };
}

function readings(
  observations: SourceObservations,
  batches: ReadonlyArray<{ vacancies: UnifiedVacancy[]; failed?: boolean; atDaysAgo: number }>,
): SourceObservations {
  return batches.reduce(
    (acc, batch) =>
      recordReading(acc, {
        succeeded: !batch.failed,
        census: batch.failed ? undefined : censusOfReading(batch.vacancies, NOW),
        atMs: NOW - batch.atDaysAgo * 24 * 60 * 60 * 1000,
      }),
    observations,
  );
}

describe('B200 · живость площадки', () => {
  it('называет мёртвой площадку, у которой всё старше 180 дней', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a', publishedAt: daysAgo(200) })], atDaysAgo: 0 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.liveness.verdict).toBe('dead');
    expect(health.liveness.reason).toContain('180');
    expect(health.liveness.fresherThan180Days).toEqual({ counted: 0, of: 1 });
  });

  it('роняет живость после трёх пустых уловов подряд, не трогая доверие', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a' })], atDaysAgo: 4 },
      { vacancies: [], atDaysAgo: 3 },
      { vacancies: [], atDaysAgo: 2 },
      { vacancies: [], atDaysAgo: 1 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.liveness.verdict).toBe('fading');
    expect(health.liveness.reason).toContain('три');
    expect(health.liveness.consecutiveEmptyReadings).toBe(3);
    // Доверие живёт своей шкалой: улов был полным, опросы проходили.
    expect(health.trust.verdict).toBe('trusted');
  });

  it('не хоронит площадку из-за объявления, датированного будущим', () => {
    // Расхождение часов площадки и сервера — не доказательство архива.
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a', publishedAt: daysAgo(-2) })], atDaysAgo: 0 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.liveness.verdict).toBe('alive');
    expect(health.liveness.fresherThan30Days).toEqual({ counted: 1, of: 1 });
  });

  it('никогда не опрошенная площадка не выдаёт себя за живую', () => {
    const health = describeSourceHealth(
      emptySourceObservations(),
      { addressStatus: 'live' },
      NOW,
    );

    expect(health.liveness.verdict).toBe('never_read');
    expect(health.trust.verdict).toBe('unknown');
  });

  it('ошибка транспорта на последнем опросе называется недоступностью', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a' })], atDaysAgo: 2 },
      { vacancies: [], failed: true, atDaysAgo: 1 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.liveness.verdict).toBe('unreachable');
  });
});

describe('B200 · доверие площадке', () => {
  it('роняет доверие, когда у 86 из 96 карточек нет работодателя', () => {
    const cards = Array.from({ length: 96 }, (_, index) =>
      card({
        id: `v${index}`,
        // Выдуманное имя работодателем не считается — регресс B164 среза 3.
        company: index < 10 ? 'GitLab' : 'Tech Company',
      }),
    );
    const observed = readings(emptySourceObservations(), [{ vacancies: cards, atDaysAgo: 0 }]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.trust.verdict).toBe('low');
    expect(health.trust.completeness.withEmployer).toEqual({ counted: 10, of: 96 });
    expect(health.trust.reasons.join(' ')).toContain('10 из 96');
  });

  it('называет подлинность неизмеренной, а не выдумывает число', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a' })], atDaysAgo: 0 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.trust.authenticity).toEqual({ measured: false, blockedBy: 'B205' });
  });

  it('площадка без установленного права не считается доверенной', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a' })], atDaysAgo: 0 },
    ]);

    const health = describeSourceHealth(
      observed,
      { addressStatus: 'robots_forbidden' },
      NOW,
    );

    expect(health.trust.verdict).toBe('low');
    expect(health.trust.lawfulness.permitted).toBe(false);
  });

  it('считает постоянство успешных опросов и называет знаменатель', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [card({ id: 'a' })], atDaysAgo: 4 },
      { vacancies: [], failed: true, atDaysAgo: 3 },
      { vacancies: [card({ id: 'b' })], atDaysAgo: 2 },
      { vacancies: [card({ id: 'c' })], atDaysAgo: 1 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.trust.consistency.successful).toEqual({ counted: 3, of: 4 });
  });

  it('забывает опросы старше окна в 30 дней вместо вечного среднего', () => {
    const observed = readings(emptySourceObservations(), [
      { vacancies: [], failed: true, atDaysAgo: 200 },
      { vacancies: [card({ id: 'a' })], atDaysAgo: 1 },
    ]);

    const health = describeSourceHealth(observed, { addressStatus: 'live' }, NOW);

    expect(health.trust.consistency.successful).toEqual({ counted: 1, of: 1 });
  });
});
