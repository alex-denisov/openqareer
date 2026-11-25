import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyMoneyCell, vacancyMoneySummary } from './VacancyMoneyCell';

const computedAt = '2026-10-05T03:00:00.000Z';

function item(
  salary: MatchedVacancyItem['cluster']['salary'],
  marketSalary?: MatchedVacancyItem['explanation']['marketSalary'],
): MatchedVacancyItem {
  return {
    cluster: {
      id: 'c-1',
      canonicalTitle: 'Head of Platform Engineering',
      canonicalCompany: 'Арка Холдинг',
      isRemote: false,
      salary,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.test',
      sources: [],
      firstObservedAt: computedAt,
      lastSeenAt: computedAt,
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: 'c-1',
      roleMatch: 'exact',
      levelMatch: 'match',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: computedAt,
      ...(marketSalary ? { marketSalary } : {}),
    },
  } as unknown as MatchedVacancyItem;
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

describe('VacancyMoneyCell (B546)', () => {
  it('shows the market estimate with its badge and date', () => {
    const markup = renderToStaticMarkup(
      <VacancyMoneyCell
        item={item(undefined, {
          low: 480_000,
          high: 560_000,
          currency: 'RUR',
          period: 'month',
          tax: 'unknown',
          computedAt,
        })}
        observedDate="05.10"
      />,
    );
    expect(text(markup)).toBe('≈ 480–560 тыс. ₽ оценка Оценка openqareer, 05.10');
  });

  it('keeps a stated salary as it was', () => {
    const markup = renderToStaticMarkup(
      <VacancyMoneyCell
        item={item({ from: 450_000, to: 600_000, currency: 'RUR' })}
        observedDate="05.10"
      />,
    );
    expect(text(markup)).toContain('указана в вакансии · источник неизвестен, 05.10');
  });
});

describe('vacancyMoneySummary (G5 item 8: 390 push = 1440 row)', () => {
  it('gives the push the openqareer estimate or missing salary', () => {
    const estimate = { currency: 'RUR', period: 'month', tax: 'unknown', computedAt } as const;
    expect(
      vacancyMoneySummary(item(undefined, { ...estimate, low: 480_000, high: 560_000 })),
    ).toEqual({
      value: '≈ 480–560 тыс. ₽ оценка',
      note: 'Оценка openqareer, 05.10',
      fromSource: false,
    });
    expect(vacancyMoneySummary(item(undefined))).toMatchObject({ value: 'не указана' });
  });
});
