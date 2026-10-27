import { describe, expect, it } from 'vitest';
import { CANDIDATE_REGIONS } from '../../src/features/workspace/candidateRegions';
import {
  DEMAND_TARGET_COUNT,
  FAN_SIZE,
  FAN_TERMS,
  fanCombosForSync,
  MARKET_TARGETS,
  fanComboAt,
  fanRegions,
  fanStartIndex,
} from './jobspyFan';

/**
 * B218 — веер обязан покрывать те рынки, которые платформа спрашивает у
 * кандидата. Регион, названный в мастере и не покрытый сбором, — обещание
 * поиска, которого нет.
 */
describe('веер рынков (B218)', () => {
  it('не дублирует термины и содержит C-Level и middle-management coverage (B235)', () => {
    expect(new Set(FAN_TERMS).size).toBe(FAN_TERMS.length);
    for (const term of [
      'ceo',
      'chief technology officer',
      'head of product',
      'director of engineering',
      'engineering manager',
      'product lead',
      'program manager',
    ]) {
      expect(FAN_TERMS).toContain(term);
    }
    expect(FAN_TERMS.length).toBeGreaterThan(60);
  });

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
    expect(fanStartIndex(windows * intervalMinutes * 60_000, intervalMinutes, combosPerSync)).toBe(
      0,
    );
  });
});

describe('опрос начинается с ролей кандидатов (27.10)', () => {
  it('роли спроса идут первыми и не съедают весь опрос', () => {
    const combos = fanCombosForSync(0, 60, 30, ['head of ai', 'vp of customer support']);
    expect(combos).toHaveLength(30);
    const demand = combos.filter((combo) =>
      ['head of ai', 'vp of customer support'].includes(combo.term),
    );
    expect(demand.length).toBeGreaterThan(0);
    expect(demand.length).toBeLessThanOrEqual(15);
    expect(combos[0]?.term).toBe('head of ai');
    expect(combos.slice(demand.length).every((combo) => FAN_TERMS.includes(combo.term))).toBe(true);
  });

  it('новая роль за сутки проходит все рынки спроса', () => {
    const seen = new Set<string>();
    for (let hour = 0; hour < 24; hour += 1) {
      for (const combo of fanCombosForSync(hour * 3_600_000, 60, 30, ['head of ai'])) {
        if (combo.term === 'head of ai') seen.add(combo.target.location);
      }
    }
    expect(seen.size).toBe(DEMAND_TARGET_COUNT);
  });

  it('без спроса опрос — прежнее окно веера', () => {
    const start = fanStartIndex(0, 60, 30);
    expect(fanCombosForSync(0, 60, 30, [])).toEqual(
      Array.from({ length: 30 }, (_, step) => fanComboAt(start + step)),
    );
  });
});

describe('спрос LinkedIn и Indeed — только латиница (27.10)', () => {
  it('русские названия ролей уходят только в поиск hh', () => {
    const combos = fanCombosForSync(Date.now(), 60, 40, ['главный бухгалтер', 'head of ai']);
    expect(combos.some((combo) => combo.term === 'главный бухгалтер')).toBe(false);
    expect(combos.some((combo) => combo.term === 'head of ai')).toBe(true);
  });
});
