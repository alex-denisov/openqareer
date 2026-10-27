import { describe, expect, it } from 'vitest';
import { renderCatalogDocument } from './vacancyCatalogDocument';
import { buildListingPageFromEntries, type CatalogEntry } from './vacancyCatalogPage';
import { catalogFilterGroupsFromListings } from './vacancyCatalogFilters';
import { relativeDay } from './catalogListingJobs';
import { salaryStats } from './catalogSalaryStats';

const now = new Date('2026-10-26T12:00:00Z');

function entry(i: number, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    key: `k${i}`,
    path: `/vacancies/job/${i}`,
    title: 'Бухгалтер',
    company: `Компания ${i}`,
    isRemote: false,
    salaryLabel: '120 000 — 140 000 ₽',
    summary: '',
    skills: [],
    sourceUrl: 'https://example.test',
    publishedAt: '2026-10-26T08:00:00Z',
    lastSeenAt: '2026-10-26T09:00:00Z',
    sourceCount: 1,
    sourceName: 'hh.ru',
    ...over,
  };
}

const summary = {
  place: 'moscow',
  placeLabel: 'Москва',
  role: 'accountant',
  roleLabel: 'Бухгалтер',
  path: '/vacancies/moscow/accountant',
  count: 438,
};
const listings = [
  summary,
  {
    ...summary,
    place: 'almaty',
    placeLabel: 'Алматы',
    path: '/vacancies/almaty/accountant',
    count: 219,
  },
  { ...summary, role: 'lawyer', roleLabel: 'Юрист', path: '/vacancies/moscow/lawyer', count: 257 },
];
const ranges = Array.from({ length: 6 }, (_, i) => `${100 + i * 10} 000 — ${120 + i * 10} 000 ₽`);

function render(total = 438, stats = salaryStats(ranges)) {
  const entries = Array.from({ length: 24 }, (_, i) =>
    entry(i + 1, i === 9 ? { salaryLabel: undefined, isRemote: true } : {}),
  );
  const page = buildListingPageFromEntries(entries, summary, 1, total);
  const withNext = { ...page, nextPath: '/vacancies/moscow/accountant?after=x' };
  return renderCatalogDocument(
    withNext,
    catalogFilterGroupsFromListings(listings, { place: 'moscow', role: 'accountant' }),
    { stats, now },
  );
}

describe('catalog list page (mockup 08)', () => {
  const html = render().replace(/[\u00a0\u202f]/gu, ' ');
  const main = html.slice(html.indexOf('<main'));

  it('names role and city in the heading, crumbs and questions', () => {
    expect(html).toContain('<h1>Вакансии бухгалтера в Москве</h1>');
    expect(html).toContain(
      '<a href="/">Главная</a><span aria-hidden="true">/</span><a href="/vacancies">Вакансии</a>',
    );
    expect(html).toContain('<span>Бухгалтер</span></nav>');
    expect(html).toContain('О вакансиях бухгалтера в Москве');
    expect(html).toContain('Сколько платят бухгалтеру в Москве?');
  });

  it('prints facts counted from the list', () => {
    expect(html).toContain('<b>6</b> с зарплатой, из них 6 с вилкой «от — до»');
    expect(html).toContain('медиана вилок <b>135 000 ₽</b>');
    expect(html).toContain('Зарплаты в вакансиях Москвы');
    expect(html).toContain('Присылать новые вакансии бухгалтера');
  });

  it('renders the table header, rows, the inline sign-up row after the fifth and the pager', () => {
    expect(html).toContain('Сначала новые · 1–24 из 438');
    expect(html).toContain('<span class="lv-s">120 000–140 000 ₽</span>');
    expect(html).toContain('зарплата не указана');
    expect(html).toContain('hh.ru · сегодня');
    expect(main.indexOf('Какие из 438 подходят вам?')).toBeGreaterThan(
      main.indexOf('/vacancies/job/5"'),
    );
    expect(main.indexOf('Какие из 438 подходят вам?')).toBeLessThan(
      main.indexOf('/vacancies/job/6"'),
    );
    expect(html).toContain('Страница 1 из 19');
    expect(html).toContain('Следующие 24');
  });

  it('links other cities and other roles with counts', () => {
    expect(html).toContain('Бухгалтер в других городах');
    expect(html).toContain('Алматы<span>219</span>');
    expect(html).toContain('Другие вакансии в Москве');
    expect(html).toContain('Юрист<span>257</span>');
  });

  it('leaves out the median when there are too few ranges', () => {
    const thin = render(438, salaryStats(ranges.slice(0, 2))).replace(/[\u00a0\u202f]/gu, ' ');
    expect(thin).not.toContain('медиана');
    expect(thin).not.toContain('Зарплаты в вакансиях');
    expect(thin).toContain('Присылать новые вакансии бухгалтера');
  });

  it('has no inline script or style and no filter chips it cannot serve', () => {
    expect(html).not.toMatch(/<script(?![^>]*src=)(?![^>]*ld\+json)[^>]*>/u);
    expect(html).not.toContain(' style=');
    expect(html).not.toContain('Удалённо или гибрид');
  });
});

describe('relativeDay', () => {
  it('says today, yesterday, days ago and then the date', () => {
    expect(relativeDay('2026-10-26T01:00:00Z', now)).toBe('сегодня');
    expect(relativeDay('2026-10-25T08:00:00Z', now)).toBe('вчера');
    expect(relativeDay('2026-10-23T08:00:00Z', now)).toBe('3 дня назад');
    expect(relativeDay('2026-10-21T08:00:00Z', now)).toBe('5 дней назад');
    expect(relativeDay('2026-08-01T08:00:00Z', now)).toBe('1 августа 2026');
  });
});
