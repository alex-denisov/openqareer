import { describe, expect, it } from 'vitest';
import { CANDIDATE_REGIONS } from '../../src/features/workspace/candidateRegions';
import { FAN_SIZE, FAN_TERMS, MARKET_TARGETS, fanComboAt, fanRegions, fanStartIndex } from './jobspyFan';

/**
 * B218 — веер обязан покрывать те рынки, которые платформа спрашивает у
 * кандидата. Регион, названный в мастере и не покрытый сбором, — обещание
 * поиска, которого нет.
 */
describe('веер рынков (B218)', () => {
  it('покрывает каждый регион, который платформа спрашивает у кандидата', () => {
    const covered = new Set(fanRegions());
    for (const region of CANDIDATE_REGIONS) {
      expect(covered.has(region), `регион ${region} не покрыт веером`).toBe(true);
    }
    // Плюс удалёнка без привязки к стране — рынок, названный владельцем.
    expect(covered.has('global')).toBe(true);
  });

  it('у каждого рынка есть читаемая локация, а код страны Indeed — заглавный', () => {
    for (const target of MARKET_TARGETS) {
      expect(target.location.trim().length).toBeGreaterThan(0);
      if (target.indeedCountry) expect(target.indeedCountry).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('рынок меняется на каждом шаге, роль — раз в круг по рынкам', () => {
    const first = fanComboAt(0);
    const second = fanComboAt(1);
    expect(second.target.location).not.toBe(first.target.location);
    expect(second.term).toBe(first.term);
    // Полный круг по рынкам — следующая роль.
    const nextRound = fanComboAt(MARKET_TARGETS.length);
    expect(nextRound.target.location).toBe(first.target.location);
    expect(nextRound.term).not.toBe(first.term);
  });

  it('индекс комбинации замыкается по кругу и не выходит за веер', () => {
    expect(fanComboAt(FAN_SIZE)).toEqual(fanComboAt(0));
    expect(fanComboAt(-1)).toEqual(fanComboAt(FAN_SIZE - 1));
    expect(FAN_SIZE).toBe(FAN_TERMS.length * MARKET_TARGETS.length);
  });

  it('окно проходит весь веер и возвращается к началу, не пропуская комбинаций', () => {
    const combosPerSync = 30;
    const intervalMinutes = 60;
    const windows = Math.ceil(FAN_SIZE / combosPerSync);
    const starts = new Set<number>();
    for (let tick = 0; tick < windows; tick += 1) {
      starts.add(fanStartIndex(tick * intervalMinutes * 60_000, intervalMinutes, combosPerSync));
    }
    expect(starts.size).toBe(windows);
    // Следующий круг начинается заново, а не уползает.
    expect(fanStartIndex(windows * intervalMinutes * 60_000, intervalMinutes, combosPerSync)).toBe(0);
  });
});
