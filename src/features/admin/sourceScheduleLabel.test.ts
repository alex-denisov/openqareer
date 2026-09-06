import { describe, expect, it } from 'vitest';
import { sourceScheduleLabel } from './sourceScheduleLabel';
import type { AdminSourceSchedule } from './adminApi';

function schedule(overrides: Partial<AdminSourceSchedule> = {}): AdminSourceSchedule {
  return {
    due: true,
    nextInMin: 0,
    intervalMin: 120,
    crawlDelaySec: null,
    robots: 'allowed' as const,
    hourly: 3,
    hourlyMax: 30,
    failures: 0,
    reason: 'интервал вышел',
    ...overrides,
  };
}

describe('расписание площадки словами (B204)', () => {
  /**
   * В карточке площадки уже стоит настроенный интервал («Интервал: 60 мин»).
   * Адаптированный интервал бывает другим (90), и назвать оба одним словом —
   * значит показать два разных числа под одной подписью. Найдено на снимке
   * прода 2026-09-07.
   */
  it('отличает действующий интервал от настроенного', () => {
    expect(sourceScheduleLabel(schedule({ intervalMin: 90 }))).toContain(
      'действующий интервал 90 мин',
    );
  });

  it('говорит «сейчас» о готовой площадке', () => {
    expect(sourceScheduleLabel(schedule())).toBe('Опрос сейчас · действующий интервал 120 мин');
  });

  it('говорит, что срока нет, вместо выдуманной минуты', () => {
    expect(sourceScheduleLabel(schedule({ due: false, nextInMin: null }))).toContain(
      'Опрос не запланирован',
    );
  });

  it('называет ожидание в минутах и часах, а не в секундах', () => {
    expect(sourceScheduleLabel(schedule({ due: false, nextInMin: 15 }))).toContain('через 15 мин');
    expect(sourceScheduleLabel(schedule({ due: false, nextInMin: 90 }))).toContain('через 1 ч 30 мин');
    expect(sourceScheduleLabel(schedule({ due: false, nextInMin: 120 }))).toContain('через 2 ч');
  });

  it('называет правило площадки, когда она его дала', () => {
    expect(sourceScheduleLabel(schedule({ crawlDelaySec: 10 }))).toContain('пауза площадки 10 с');
  });

  it('называет отказы, когда они есть, и молчит, когда их нет', () => {
    expect(sourceScheduleLabel(schedule({ failures: 3 }))).toContain('3 отказа подряд');
    expect(sourceScheduleLabel(schedule({ failures: 1 }))).toContain('1 отказ подряд');
    expect(sourceScheduleLabel(schedule({ failures: 5 }))).toContain('5 отказов подряд');
    expect(sourceScheduleLabel(schedule())).not.toContain('отказ');
  });

  it('называет исчерпанный часовой бюджет, потому что им объясняется пауза', () => {
    expect(sourceScheduleLabel(schedule({ hourly: 30, hourlyMax: 30 }))).toContain(
      'часовой бюджет исчерпан',
    );
    expect(sourceScheduleLabel(schedule({ hourly: 3, hourlyMax: 30 }))).not.toContain('бюджет');
  });

  it('называет запрет площадки в robots.txt', () => {
    expect(sourceScheduleLabel(schedule({ robots: 'disallowed' }))).toContain(
      'robots.txt запрещает',
    );
  });
});
