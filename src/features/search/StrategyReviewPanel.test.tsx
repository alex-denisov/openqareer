import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StrategyReviewPanel } from './StrategyReviewPanel';
import type { CareerCommand } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CareerStrategy } from '../../../shared/careerStrategy';

const NOW = '2026-09-20T12:00:00.000Z';
const daysAgo = (days: number) =>
  new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const strategy: CareerStrategy = {
  current: {
    version: 1,
    role: {
      title: 'Head of Product',
      origin: 'model',
      reason: null,
      evidenceRefs: [],
      confirmation: { state: 'not-found', sampleSize: 0 },
    },
    constraints: { regions: [], note: null },
    reason: 'Первый выбор роли',
    decidedAt: daysAgo(3),
    provenance: { namedBy: null, language: 'ru', poolSize: 10 },
  },
  history: [],
};

function poolOf(count: number, observedDaysAgo = 2): MatchedVacancyItem[] {
  return Array.from({ length: count }, (_, index) => ({
    cluster: { id: `c-${index}`, firstObservedAt: daysAgo(observedDaysAgo) },
  })) as unknown as MatchedVacancyItem[];
}

function render(options: {
  pool?: MatchedVacancyItem[];
  commands?: CareerCommand[];
  strategy?: CareerStrategy | null;
}) {
  return renderToStaticMarkup(
    <StrategyReviewPanel
      strategy={options.strategy === undefined ? strategy : options.strategy}
      pool={options.pool ?? poolOf(20)}
      commands={options.commands ?? []}
      now={NOW}
    />,
  );
}

describe('StrategyReviewPanel', () => {
  it('называет порядок изменений и правило одной переменной', () => {
    const markup = render({});
    expect(markup).toContain('маршрут → материалы и скрининговые ответы');
    expect(markup).toContain('по одной переменной за раз');
    // Наращивать объём откликов запрещено как ответ на любой сигнал.
    expect(markup).not.toContain('больше откликов');
  });

  it('неотслеживаемое называет словами, а не нулём', () => {
    const markup = render({});
    expect(markup).toContain('не отслеживается ничем');
    expect(markup).not.toContain('0 из 30');
  });

  it('аварию транспорта отделяет от гипотезы роли', () => {
    // Кампания идёт десять дней, в очереди есть команда, доставленных нет.
    const markup = render({
      strategy: {
        ...strategy,
        current: { ...strategy.current, decidedAt: daysAgo(10) },
      },
      commands: [{ status: 'queued', execution: null } as unknown as CareerCommand],
    });
    expect(markup).toContain('Это не стратегия, это авария');
    expect(markup).toContain('Менять: транспорт');
  });

  it('барьер смены роли показывает числами со знаменателями', () => {
    const markup = render({});
    expect(markup).toContain('3 из 14');
    expect(markup).toContain('0 из 20');
    expect(markup).toContain('барьер не взят');
    expect(markup).toContain('обнулит накопленную воронку');
  });

  it('без выбранной роли барьера не показывает: менять нечего', () => {
    const markup = render({ strategy: null });
    expect(markup).not.toContain('Смена роли:');
  });
});
