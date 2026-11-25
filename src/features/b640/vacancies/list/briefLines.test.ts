import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { briefView } from './briefLines';

const brief = {
  duties: ['a', 'b', 'c', 'd'],
  requirements: ['Go', 'SQL', 'X', 'Y'],
  opening: 'О.',
};
const requirement = (id: string) => ({
  id,
  text: `требование ${id}`,
  kind: 'other',
  skill: true,
  origin: 'explicit',
});
const fit = {
  state: 'ready',
  requirements: ['1', '2', '3', '4'].map(requirement),
  result: {
    status: 'assessed',
    dataState: 'confirmed',
    coveragePercent: 75,
    coverage: { matched: 3, total: 4, unknown: 0 },
    assessments: [
      { requirementId: '1', status: 'matched', evidence: [] },
      { requirementId: '2', status: 'partial', evidence: [] },
      { requirementId: '4', status: 'unmatched', evidence: [] },
    ],
  },
} as unknown as VacancyFitView;

describe('краткое содержание раскрытой строки (B791)', () => {
  it('по три строки; сначала требование, которого нет в профиле', () => {
    const view = briefView(brief, fit);
    expect(view.duties).toEqual(['a', 'b', 'c']);
    expect(view.requirements).toEqual([
      { text: 'требование 4', missing: true },
      { text: 'требование 1', missing: false },
      { text: 'требование 2', missing: false },
    ]);
    expect(view.opening).toBe('');
  });

  it('расчёта нет — требования из текста без пометок', () => {
    expect(briefView(brief, undefined).requirements).toEqual(
      ['Go', 'SQL', 'X'].map((text) => ({ text, missing: false })),
    );
  });

  it('разделов нет — абзац', () => {
    expect(briefView({ duties: [], requirements: [], opening: 'О.' }, undefined).opening).toBe(
      'О.',
    );
  });
});
