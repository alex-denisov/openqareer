import { describe, expect, it } from 'vitest';
import { collectMatchedPages, evaluateStrictTop20 } from './measure-strict-top20.mjs';

describe('measure-strict-top20 (B323)', () => {
  it('разбор и подсчет строгого топ-20 на сохраненном ответе без сети', () => {
    // 20 синтетических элементов:
    // 14 элементов полностью подходят:
    //   roleMatch = 'target', levelMatch = 'match', outsideGeography = false, matched = 2, total = 3
    // 6 элементов не подходят по разным причинам:
    //   - item 15: matched = 0 (нет требований)
    //   - item 16: levelMatch = 'mismatch'
    //   - item 17: outsideGeography = true и isRemote = false
    //   - item 18: roleMatch = 'partial' с adjacentRole = true
    //   - item 19: roleMatch = 'unrelated'
    //   - item 20: matched = 0 (нет совпадений)
    const mockVacancies = Array.from({ length: 20 }, (_, idx) => {
      const i = idx + 1;
      if (i <= 14) {
        return {
          id: `vac-${i}`,
          cluster: {
            id: `cluster-${i}`,
            canonicalTitle: `Руководитель направления ${i}`,
            isRemote: false,
            description: `Полное описание вакансии ${i}`.repeat(5),
            status: 'active',
          },
          explanation: {
            roleMatch: 'target',
            adjacentRole: false,
            levelMatch: 'match',
            outsideGeography: false,
            matchingPoints: ['P&L', 'Управление командой'],
            missingPoints: ['Английский C1'],
          },
        };
      }

      if (i === 15) {
        return {
          id: `vac-${i}`,
          cluster: { canonicalTitle: 'CTO без требований', isRemote: true },
          explanation: {
            roleMatch: 'target',
            levelMatch: 'match',
            outsideGeography: false,
            matchingPoints: [],
            missingPoints: [],
          },
        };
      }

      if (i === 16) {
        return {
          id: `vac-${i}`,
          cluster: { canonicalTitle: 'Junior Developer', isRemote: true },
          explanation: {
            roleMatch: 'target',
            levelMatch: 'mismatch',
            outsideGeography: false,
            matchingPoints: ['TypeScript'],
          },
        };
      }

      if (i === 17) {
        return {
          id: `vac-${i}`,
          cluster: { canonicalTitle: 'Офисный COO в Сингапуре', isRemote: false },
          explanation: {
            roleMatch: 'target',
            levelMatch: 'match',
            outsideGeography: true,
            matchingPoints: ['Operations'],
          },
        };
      }

      if (i === 18) {
        return {
          id: `vac-${i}`,
          cluster: { canonicalTitle: 'Смежная роль', isRemote: true },
          explanation: {
            roleMatch: 'partial',
            adjacentRole: true,
            levelMatch: 'match',
            outsideGeography: false,
            matchingPoints: ['Strategy'],
          },
        };
      }

      if (i === 19) {
        return {
          id: `vac-${i}`,
          cluster: { canonicalTitle: 'Несвязанная роль', isRemote: true },
          explanation: {
            roleMatch: 'unrelated',
            levelMatch: 'match',
            outsideGeography: false,
            matchingPoints: ['Python'],
          },
        };
      }

      return {
        id: `vac-${i}`,
        cluster: { canonicalTitle: 'Вакансия без совпадений', isRemote: true },
        explanation: {
          roleMatch: 'target',
          levelMatch: 'match',
          outsideGeography: false,
          matchingPoints: [],
          missingPoints: ['Kafka'],
        },
      };
    });

    const mockCampaign = {
      suggestedRegions: ['Москва', 'Санкт-Петербург'],
    };

    const result = evaluateStrictTop20(mockVacancies, mockCampaign);

    expect(result.rows).toHaveLength(20);
    expect(result.strictScore).toBe(14);
    expect(result.threshold).toBe(14);
    expect(result.passed).toBe(true);

    // Первые 14 строк relevant: true
    for (let i = 0; i < 14; i++) {
      expect(result.rows[i].relevant).toBe(true);
      expect(result.rows[i].requirementsMatched).toBe(2);
      expect(result.rows[i].requirementsTotal).toBe(3);
      expect(result.rows[i].descriptionLength).toBeGreaterThan(0);
      expect(result.rows[i].status).toBe('active');
    }

    // Строки 15..20 relevant: false
    for (let i = 14; i < 20; i++) {
      expect(result.rows[i].relevant).toBe(false);
    }

    expect(result.roleCounts.target).toBe(18);
    expect(result.roleCounts.partial).toBe(1);
    expect(result.roleCounts.adjacent).toBe(1);
    expect(result.levelMatchCount).toBe(19);
    expect(result.withRequirementMatchCount).toBe(18);
  });

  it('собирает топ-20 из нескольких страниц по nextOffset и не идёт дальше нужного', async () => {
    const calls = [];
    const pages = [
      { data: [1, 2, 3, 4, 5, 6, 7], meta: { nextOffset: 7 } },
      { data: [8, 9, 10, 11, 12, 13, 14], meta: { nextOffset: 14 } },
      { data: [15, 16, 17, 18, 19, 20, 21], meta: { nextOffset: 21 } },
      { data: [22], meta: { nextOffset: null } },
    ];
    const fetchPage = async (offset) => {
      calls.push(offset);
      const page = pages[calls.length - 1];
      return { ok: true, status: 200, json: async () => page };
    };
    const items = await collectMatchedPages(fetchPage, 20);
    expect(items).toHaveLength(20);
    expect(items[19]).toBe(20);
    expect(calls).toEqual([0, 7, 14]);
  });

  it('останавливается, когда пул кончился раньше лимита, и не зацикливается', async () => {
    const fetchPage = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [1, 2], meta: { nextOffset: 0 } }),
    });
    expect(await collectMatchedPages(fetchPage, 20)).toEqual([1, 2]);
  });

  it('ошибка страницы — исключение с кодом ответа', async () => {
    const fetchPage = async () => ({ ok: false, status: 502, json: async () => ({}) });
    await expect(collectMatchedPages(fetchPage, 20)).rejects.toThrow('502');
  });
});
