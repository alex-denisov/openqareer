import { describe, expect, it } from 'vitest';
import { renderCatalogDocument } from './vacancyCatalogDocument';
import type { CatalogEntry, CatalogPage } from './vacancyCatalogPage';

const entry: CatalogEntry = {
  key: 'v1',
  path: '/vacancies/job/a-1',
  title: 'Бухгалтер',
  company: 'Иванов Иван Иванович',
  isRemote: false,
  summary: '',
  skills: [],
  sourceUrl: 'https://example.test/1',
  publishedAt: '2026-10-26T08:00:00Z',
  lastSeenAt: '2026-10-26T09:00:00Z',
  sourceCount: 1,
};

const page: CatalogPage = {
  heading: 'Бухгалтер — вакансии, Москва',
  documentTitle: 'Бухгалтер · openqareer',
  description: 'Описание',
  page: 1,
  pageCount: 1,
  total: 438,
  entries: [entry],
  canonicalPath: '/vacancies/moscow/accountant',
  jsonLd: { '@context': 'https://schema.org', '@graph': [] },
};

describe('catalog head (mockup 08)', () => {
  const html = renderCatalogDocument(page);

  it('shows count, data date and the alert link without inline scripts', () => {
    expect(html).toContain('<b>438</b> вакансий');
    expect(html).toContain('данные на <b>26.10.2026</b>');
    expect(html).toContain('Присылать новые вакансии');
    expect(html).toContain('src="/assets/oq-vacancy-search-1.js"');
    expect(html).not.toMatch(/<script(?![^>]*src=)(?![^>]*ld\+json)[^>]*>/u);
  });

  it('renders role and city as ARIA comboboxes with listboxes', () => {
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-controls="cat-city-l"');
    expect(html).toContain('<ul class="cat-ac" id="cat-role-l" role="listbox"');
  });

  it('never prints a private person as the employer', () => {
    expect(html).not.toContain('Иванов Иван Иванович');
    expect(html).toContain('Частный работодатель');
  });
});
