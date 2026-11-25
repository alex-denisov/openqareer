import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancySections } from './vacancyTextView';

const requirement = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  kind: 'other',
  skill: true,
  origin: 'explicit',
});
const fit = {
  state: 'ready',
  requirements: [
    requirement('1', 'Go'),
    requirement('2', 'Kubernetes'),
    requirement('3', 'Опыт в антифроде'),
    requirement('4', 'Найм руководителей'),
    requirement('5', 'English'),
  ],
  result: {
    status: 'assessed',
    dataState: 'confirmed',
    coveragePercent: 40,
    coverage: { matched: 1, total: 5, unknown: 1 },
    assessments: [
      { requirementId: '1', status: 'matched', evidence: [] },
      { requirementId: '2', status: 'unmatched', evidence: [] },
      { requirementId: '3', status: 'unmatched', evidence: [] },
      { requirementId: '4', status: 'partial', evidence: [] },
      { requirementId: '5', status: 'unknown', evidence: [] },
    ],
  },
} as unknown as VacancyFitView;
const brief = {
  duties: ['Вести команду', 'Вести команду.'],
  requirements: [
    'Google Cloud',
    'Go, Kubernetes',
    'Опыт в антифроде.',
    'Найм руководителей',
    'English',
  ],
  conditions: ['ДМС'],
  opening: 'О.',
};

describe('vacancySections (B800)', () => {
  it('все требования текста; пометки только из готового расчёта, слово целиком', () => {
    expect(vacancySections(brief, fit)).toEqual({
      duties: ['Вести команду'],
      requirements: [
        { text: 'Google Cloud' },
        { text: 'Go, Kubernetes', mark: 'частично' },
        { text: 'Опыт в антифроде.', mark: 'нет в профиле' },
        { text: 'Найм руководителей', mark: 'частично' },
        { text: 'English' },
      ],
      conditions: ['ДМС'],
    });
  });

  it('расчёта нет или он не готов — без пометок', () => {
    const counting = {
      ...fit,
      state: 'processing',
      result: undefined,
    } as unknown as VacancyFitView;
    for (const view of [undefined, counting]) {
      const lines = vacancySections(brief, view)?.requirements ?? [];
      expect(lines).toHaveLength(5);
      expect(lines.every((line) => !line.mark)).toBe(true);
    }
  });

  it('задачи есть, раздела требований нет — посчитанные требования; разделов нет — null', () => {
    const lines = vacancySections({ ...brief, requirements: [] }, fit)?.requirements;
    expect(lines).toHaveLength(5);
    expect(lines?.[2]).toEqual({ text: 'Опыт в антифроде', mark: 'нет в профиле' });
    expect(vacancySections({ duties: [], requirements: [], opening: 'О.' }, fit)).toBeNull();
  });
});
