import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyMoneyCell } from './VacancyMoneyCell';

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
  it('shows the market estimate with its badge, sample and cut date', () => {
    const markup = renderToStaticMarkup(
      <VacancyMoneyCell
        item={item(undefined, {
          low: 480_000,
          high: 560_000,
          currency: 'RUR',
          sampleSize: 41,
          basis: 'city',
          computedAt,
        })}
        observedDate="05.10"
      />,
    );
    expect(text(markup)).toBe('≈ 480–560 тыс. ₽ оценка оценка рынка по 41 вакансии, 05.10');
  });

  it('says «мало данных» without a number when the sample is thin', () => {
    const markup = renderToStaticMarkup(
      <VacancyMoneyCell
        item={item(undefined, { currency: 'RUR', sampleSize: 3, basis: 'region', computedAt })}
        observedDate="05.10"
      />,
    );
    expect(text(markup)).toBe(
      'мало данных без зарплаты нет зарплаты, оценка по 3 вакансиям, 05.10',
    );
    expect(markup).not.toContain('≈');
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
