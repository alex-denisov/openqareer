import { describe, expect, it } from 'vitest';
import type { SalaryMarketSnapshot } from './salaryMarketSnapshot';
import {
  faqStructuredData,
  formatRange,
  russianNetMonthly,
  salaryCountryView,
  salaryProfessionView,
} from './salaryPublicPages';

const group = (p25: number, p50: number, p75: number, sampleSize: number, currency = 'RUR') => ({
  currency,
  period: 'month' as const,
  taxBasis: 'gross' as const,
  sampleSize,
  p25,
  p50,
  p75,
});

const snapshot = {
  role: 'accountant',
  roleLabel: 'Бухгалтер',
  updatedAt: '2026-10-27T00:26:27.738Z',
  sampleSize: 4554,
  cityMarket: {
    method: 'closed_monthly_range_midpoint_v1',
    minSample: 20,
    rangedTotal: 400,
    publishedSample: 338,
    cities: [
      {
        city: 'Москва',
        placeSlug: 'moscow',
        vacancyCount: 438,
        salary: group(105_000, 125_000, 140_000, 266),
      },
      {
        city: 'Санкт-Петербург',
        placeSlug: 'saint-petersburg',
        vacancyCount: 212,
        salary: group(90_000, 95_100, 113_750, 72),
      },
    ],
    remote: {
      city: 'Удалённо',
      placeSlug: 'remote',
      vacancyCount: 132,
      salary: group(4000, 5000, 6000, 48, 'USD'),
    },
  },
} as unknown as SalaryMarketSnapshot;

describe('salary profession view (B351 06a)', () => {
  it('builds the answer, ranges and remote line from the snapshot only', () => {
    const view = salaryProfessionView(snapshot)!;
    expect(view.lead.city).toBe('Москва');
    expect(view.lead.range).toBe('105 000–140 000 ₽');
    expect(view.lead.median).toBe('125 000 ₽');
    expect(view.leadNet).toBe('108 750 ₽');
    expect(view.answer).toContain('266 вакансий с вилкой');
    expect(view.answer).toContain('27.10.2026');
    expect(view.remote).toEqual({ median: '5 000 $ в месяц', sampleSize: 48 });
    expect(view.cities.map((city) => city.city)).toEqual(['Москва', 'Санкт-Петербург']);
    expect(view.cities[0]!.bar!.mark).toBeGreaterThan(view.cities[1]!.bar!.mark);
  });

  it('has no view when no city reaches the minimum', () => {
    const empty = { ...snapshot, cityMarket: { ...snapshot.cityMarket!, cities: [] } };
    expect(salaryProfessionView(empty)).toBeNull();
    expect(salaryProfessionView({ ...snapshot, cityMarket: undefined })).toBeNull();
  });

  it('turns the visible questions into FAQPage', () => {
    const view = salaryProfessionView(snapshot)!;
    const data = faqStructuredData(view.faqs) as { mainEntity: { name: string }[] };
    expect(data.mainEntity.map((item) => item.name)).toEqual(view.faqs.map((faq) => faq.question));
  });
});

describe('salary country view (B351 06b)', () => {
  it('takes every net figure from the tax calculator', () => {
    const view = salaryCountryView('germany');
    expect(view.reference.gross).toBe('5 000 €');
    expect(view.rows.some((row) => row.note === 'порог Blue Card' && row.gross === '4 225 €')).toBe(
      true,
    );
    expect(view.thresholds.map((item) => item.amount)).toContain('50 700 € в год');
    expect(view.others.map((item) => item.slug)).toContain('cyprus');
    expect(view.faqs.length).toBeGreaterThanOrEqual(2);
  });

  it('lists catalog cities from 30 vacancies, the largest first', () => {
    const view = salaryCountryView('germany', {
      readAt: '2026-10-27T10:00:00Z',
      cities: [
        { slug: 'munich', label: 'Мюнхен', count: 612 },
        { slug: 'hamburg', label: 'Гамбург', count: 29 },
        { slug: 'berlin', label: 'Берлин', count: 945 },
        { slug: 'paris', label: 'Париж', count: 900 },
      ],
    });
    expect(view.cities.map((city) => city.slug)).toEqual(['berlin', 'munich']);
    expect(view.cities[0]!.genitive).toBe('Берлина');
    expect(view.catalogDate).toBe('27.10.2026');
    expect(view.toName).toBe('в Германию');
    expect(salaryCountryView('germany').cities).toEqual([]);
  });

  it('keeps the Russian take-home consistent with the calculator', () => {
    expect(russianNetMonthly(125_000)).toBe(108_750);
    expect(formatRange(group(1, 2, 3, 30))).toBe('1–3 ₽');
  });
});
