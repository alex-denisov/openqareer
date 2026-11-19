import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../shared/vacancyFit';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import {
  LEAN_PAGE_SIZE,
  buildLeanMatchedPage,
  leanFitView,
  leanPageOffsets,
  leanRow,
} from './leanMatchedPage';

function item(index: number): MatchedVacancyItem {
  return {
    cluster: {
      id: `c-${index}`,
      canonicalTitle: `Инженер ${index}`,
      canonicalCompany: 'Компания',
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: ['SQL', 'Python'],
      descriptionSummary: 'Описание. '.repeat(50),
      primaryUrl: `https://example.test/${index}`,
      sources: [],
      firstObservedAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: `c-${index}`,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: ['SQL', 'Python', 'Airflow', 'dbt'],
      missingPoints: ['Kafka', 'Spark'],
      matchingFacts: [{ text: 'SQL' }, { text: 'Python' }],
      summary: 'Совпало 1 из 2 требований вакансии.',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  } as unknown as MatchedVacancyItem;
}

const pool = (size: number) => Array.from({ length: size }, (_, index) => item(index));

describe('облегчённая страница подбора (B725)', () => {
  it('смещения кратны 20 и считаются по одному числу строк', () => {
    expect(LEAN_PAGE_SIZE).toBe(20);
    expect(leanPageOffsets(0)).toEqual([0]);
    expect(leanPageOffsets(20)).toEqual([0]);
    expect(leanPageOffsets(45)).toEqual([0, 20, 40]);
  });

  it('страница — ровно 20 строк, план только на первой', () => {
    const all = pool(45);
    const first = buildLeanMatchedPage(all, 0);
    expect(first.items).toHaveLength(20);
    expect(first).toMatchObject({ total: 45, offset: 0, nextOffset: 20, pageOffsets: [0, 20, 40] });
    const last = buildLeanMatchedPage(all, 40);
    expect(last.items.map(({ cluster }) => cluster.id)).toEqual([
      'c-40',
      'c-41',
      'c-42',
      'c-43',
      'c-44',
    ]);
    expect(last.nextOffset).toBeNull();
    expect(last.pageOffsets).toBeUndefined();
  });

  it('строка без списков требований и описания, счёт остаётся', () => {
    const row = leanRow(item(1));
    expect(row.cluster.descriptionSummary).toBe('');
    expect(row.cluster.skills).toEqual([]);
    expect(row.explanation.matchingPoints).toEqual([]);
    expect(row.explanation.missingPoints).toEqual([]);
    expect(row.explanation.matchingFacts).toBeUndefined();
    expect(row.explanation).toMatchObject({
      matchingCount: 4,
      missingCount: 2,
      roleMatch: 'target',
    });
  });

  it('разбор в строке: состояние и процент без порогов, пунктов и оценок', () => {
    const view = {
      state: 'ready',
      requirements: [{ id: 'r1', text: 'SQL' }],
      points: [{ text: 'SQL', status: 'matched' }],
      result: {
        status: 'assessed',
        dataState: 'known',
        coveragePercent: 80,
        coverage: { matched: 4, total: 5 },
        reason: undefined,
        gates: { geo: { status: 'pass', reason: 'ok' } },
        assessments: [{ requirementId: 'r1', status: 'matched', evidence: [] }],
        implied: [{ requirementId: 'r1' }],
        duties: ['вести'],
      },
    } as unknown as VacancyFitView;
    const lean = leanFitView(view);
    expect(lean).toMatchObject({ state: 'ready', requirements: [] });
    expect(lean.points).toBeUndefined();
    expect(lean.result).toMatchObject({
      status: 'assessed',
      coveragePercent: 80,
      coverage: { matched: 4, total: 5 },
      assessments: [],
    });
    expect(lean.result).not.toHaveProperty('gates');
    expect(lean.result).not.toHaveProperty('implied');
    expect(lean.result).not.toHaveProperty('duties');
  });
});
