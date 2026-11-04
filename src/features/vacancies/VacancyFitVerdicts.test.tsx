import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import { VacancyFitVerdicts } from './VacancyFitVerdicts';

const requirement = (id: string, text: string) =>
  ({
    id,
    text,
    sourceQuote: text,
    kind: 'other',
    skill: true,
    label: text,
  }) as unknown as VacancyFitView['requirements'][number];

const view = {
  state: 'ready',
  requirements: [
    requirement('a', 'Kafka'),
    requirement('b', 'Виза'),
    requirement('c', 'Лидерство'),
  ],
  result: {
    assessments: [
      { requirementId: 'a', status: 'unknown', evidence: [] },
      { requirementId: 'b', status: 'unmatched', evidence: [{ factId: 'f', quote: 'Москва' }] },
      { requirementId: 'c', status: 'unknown', evidence: [] },
    ],
    implied: [{ requirementId: 'c', role: 'VP of Technology' }],
  },
} as unknown as VacancyFitView;

describe('VacancyFitVerdicts', () => {
  const html = renderToStaticMarkup(<VacancyFitVerdicts view={view} />);
  const row = (name: string) => html.split('<li').find((item) => item.includes(name)) ?? '';

  it('says an unassessed requirement is unknown, not absent from the profile (04.11)', () => {
    expect(row('Kafka')).toContain('неизвестно');
    expect(html).not.toContain('нет в профиле');
  });

  it('names a contradiction apart and shows the quote behind it', () => {
    expect(row('Виза')).toContain('расходится с профилем');
    expect(row('Виза')).toContain('Москва');
  });

  it('shows an implied skill as met with the role it follows from', () => {
    expect(row('Лидерство')).toContain('есть в профиле, следует из опыта: VP of Technology');
  });
});
