import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VacancyFitInline, VacancyFitSummary } from './VacancyFitSummary';
import { readyVacancyFit } from '../../../e2e/fixtures/vacancyFit';
import { sortVacancyFitItems } from './VacancyFitSort';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
it('shows factual count, percent and date with source coverage semantics', () => {
  const html = renderToStaticMarkup(<VacancyFitSummary view={readyVacancyFit()} />);
  expect(html).toContain('50%');
  expect(html).toContain('1 из 2 требований');
  expect(html).toContain('18.10.2026');
});
it('unknown and blocked result never renders a number even if stale numeric data arrives', () => {
  const view = readyVacancyFit();
  for (const status of ['unknown', 'blocked'] as const) {
    const html = renderToStaticMarkup(
      <VacancyFitSummary
        view={{
          ...view,
          result: {
            ...view.result!,
            status,
            reason: status === 'blocked' ? 'blocked_gate' : 'unknown_gate',
          },
        }}
      />,
    );
    expect(html).not.toContain('50%');
    expect(html).toContain('обязател');
  }
});
it('no-description state explains unavailable coverage without invented zero', () => {
  const html = renderToStaticMarkup(
    <VacancyFitSummary view={{ state: 'no_description', requirements: [] }} />,
  );
  expect(html).toContain('Нет описания');
  expect(html).not.toContain('0%');
});
it('known coverage precedes unknown, ties preserve existing order, freshness is explicit', () => {
  const item = (id: string, date: string, fitView?: ReturnType<typeof readyVacancyFit>) =>
    ({ cluster: { id, firstObservedAt: date }, explanation: { fitView } }) as MatchedVacancyItem;
  const a = item('unknown', '2026-10-19');
  const b = item('known', '2026-10-17', readyVacancyFit());
  const c = item('tied', '2026-10-18', readyVacancyFit());
  expect(sortVacancyFitItems([a, b, c]).map((i) => i.cluster.id)).toEqual([
    'known',
    'tied',
    'unknown',
  ]);
  expect(sortVacancyFitItems([a, b, c], 'freshness').map((i) => i.cluster.id)).toEqual([
    'unknown',
    'tied',
    'known',
  ]);
});

it('mandatory requirement coverage precedes overall coverage for supplied local pools', () => {
  const base = readyVacancyFit();
  const make = (id: string, overall: number, required: number) =>
    ({
      cluster: { id, firstObservedAt: '2026-10-18' },
      explanation: {
        fitView: {
          ...base,
          result: {
            ...base.result!,
            coveragePercent: overall,
            requiredCoverage: { matched: required, total: 100, percent: required },
          },
        },
      },
    }) as MatchedVacancyItem;
  expect(
    sortVacancyFitItems([make('overall-high', 90, 50), make('mandatory-high', 50, 100)]).map(
      (item) => item.cluster.id,
    ),
  ).toEqual(['mandatory-high', 'overall-high']);
});

it('names unconfirmed conditions next to the percent instead of passing them off as a match', () => {
  const view = readyVacancyFit();
  const html = renderToStaticMarkup(
    <VacancyFitSummary
      view={{
        ...view,
        result: {
          ...view.result!,
          dataState: 'partial',
          gates: {
            ...view.result!.gates,
            region: { status: 'unknown', reason: 'География не подтверждена.' },
            workAuthorization: { status: 'unknown', reason: 'Не указано.' },
          },
        },
      }}
    />,
  );
  expect(html).toContain('50%');
  expect(html).toContain('Не подтверждено: регион, право на работу');
});

it('row inline fit shows only a computed percent and nothing for pending states (B446-g4)', () => {
  expect(renderToStaticMarkup(<VacancyFitInline view={readyVacancyFit()} />)).toContain(
    'Соответствие 50\u00a0%',
  );
  for (const state of ['not_requested', 'processing', 'retrying', 'failed'] as const) {
    expect(renderToStaticMarkup(<VacancyFitInline view={{ state, requirements: [] }} />)).toBe('');
  }
  expect(renderToStaticMarkup(<VacancyFitInline />)).toBe('');
});
