import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VacancyFitSummary } from './VacancyFitSummary';
import { VacancyFitCell } from './VacancyFitMark';

const cell = (view?: MatchedVacancyItem['explanation']['fitView']) =>
  renderToStaticMarkup(
    <VacancyFitCell
      item={
        { cluster: { id: 'v1' }, explanation: { fitView: view } } as unknown as MatchedVacancyItem
      }
    />,
  );
import { readyVacancyFit } from '../../../e2e/fixtures/vacancyFit';
import { sortVacancyFitItems } from './VacancyFitSort';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
it('shows factual count, percent and date with source coverage semantics', () => {
  const html = renderToStaticMarkup(<VacancyFitSummary view={readyVacancyFit()} />);
  expect(html).toContain('50%');
  expect(html).toContain('2 из 4 требований');
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
it('known coverage precedes unknown, ties preserve existing order', () => {
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
});

it('orders by the shown percent, as the server does (28.10)', () => {
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
  ).toEqual(['overall-high', 'mandatory-high']);
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

it('the row cell shows the coloured percent, «считаем» or «нет процента» (28.10 mockup)', () => {
  expect(cell(readyVacancyFit())).toMatch(/aria-label="Совпадение 50 %, по \d+ требованиям"/u);
  expect(cell(readyVacancyFit())).toContain('is-mid');
  for (const state of ['not_requested', 'processing', 'retrying'] as const) {
    expect(cell({ state, requirements: [] })).toContain('считаем');
  }
  const ready = readyVacancyFit();
  expect(
    cell({
      ...ready,
      result: { ...ready.result!, status: 'unknown', reason: 'no_eligible_facts' },
    }),
  ).toContain('нет профиля');
  expect(cell(readyVacancyFit())).not.toContain('соответствие');
});

it('compact card summary is one caption line «Соответствие: …» (B525 V4)', () => {
  const ready = readyVacancyFit();
  const html = renderToStaticMarkup(
    <VacancyFitSummary
      compact
      view={{
        ...ready,
        result: { ...ready.result!, status: 'unknown', reason: 'no_eligible_facts' },
      }}
    />,
  );
  expect(html).toContain('Соответствие: в профиле нет подтверждённых фактов для сравнения');
  expect(html).toContain('career-sr-only');
});

it('a single requirement never yields a percent, even from a stale result (A1)', () => {
  const ready = readyVacancyFit();
  const single = {
    ...ready,
    result: {
      ...ready.result!,
      coveragePercent: 100,
      coverage: { matched: 1, total: 1, unknown: 0 },
    },
  };
  for (const html of [cell(single), renderToStaticMarkup(<VacancyFitSummary view={single} />)]) {
    expect(html).not.toContain('100');
  }
  expect(renderToStaticMarkup(<VacancyFitSummary view={single} />)).toMatch(/Мало требований/);
});
it.each([
  ['model_unavailable', 'Соответствие: расчёт не завершился: сервис сравнения не ответил'],
  [
    'model_invalid',
    'Соответствие: расчёт не завершился: ответ сервиса сравнения не прошёл проверку',
  ],
  ['requirements', 'Соответствие: расчёт не завершился: требования вакансии не разобраны'],
  ['profile_changed', 'Соответствие: профиль изменился во время расчёта'],
  [undefined, 'Соответствие: расчёт не завершился'],
] as const)('failed names its real cause, never «try again» (B562-r): %s', (failure, text) => {
  const html = renderToStaticMarkup(
    <VacancyFitSummary
      compact
      view={{ state: 'failed', requirements: [], ...(failure ? { failure } : {}) }}
    />,
  );
  expect(html).toContain(`${text}<`);
  expect(html).not.toMatch(/Попробуйте|недоступен/u);
});

it('keeps the previous percent while the new version is calculated (B562-r)', () => {
  const view = { ...readyVacancyFit(), state: 'refreshing' as const };
  expect(renderToStaticMarkup(<VacancyFitSummary view={view} />)).toMatch(/50%.*Пересчитывается/su);
  expect(cell(view)).toContain('Совпадение 50 %');
});
