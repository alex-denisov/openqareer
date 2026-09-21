import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancySubscription } from '../coach/coachApi';
import { VacancyFilterPanel } from './VacancyFilterPanel';
import { calculateVacancyFacets } from './vacancyFacets';

const subscription: VacancySubscription = {
  id: 'sub-1',
  source: 'remotive',
  query: 'Product Manager',
  status: 'active',
  cadenceMinutes: 360,
  nextRunAt: '2026-09-02T14:00:00.000Z',
  lastAttemptAt: '2026-09-02T08:00:00.000Z',
  lastSuccessAt: '2026-09-02T08:00:00.000Z',
  lastErrorCode: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-02T08:00:00.000Z',
  analytics: {
    sampleSize: 41,
    sourceFound: 74,
    salaryKnown: 12,
    unknownSalary: 29,
    observedFrom: '2026-08-03T08:00:00.000Z',
    observedTo: '2026-09-02T08:00:00.000Z',
    currencies: [],
    topLocations: [],
  },
};

function render(overrides: Partial<Parameters<typeof VacancyFilterPanel>[0]> = {}) {
  const items: MatchedVacancyItem[] = [];
  return renderToStaticMarkup(
    <VacancyFilterPanel
      filters={{}}
      facets={calculateVacancyFacets(items)}
      sources={[{ source: 'Remotive', count: 12 }]}
      countries={[
        { country: 'Германия', count: 9 },
        { country: 'Россия', count: 4 },
        { country: 'Кипр', count: 2 },
        { country: 'Польша', count: 1 },
      ]}
      onChange={vi.fn()}
      onReset={vi.fn()}
      subscriptions={[subscription]}
      defaultQuery="Xray Technician"
      onRefresh={vi.fn(async () => undefined)}
      {...overrides}
    />,
  );
}

// B234: панель фильтров по макету «Пульт» — один заголовок «Фильтры», поле
// поиска, сохранённые выборки пилюлями, роль как фильтр, страна, формат,
// свежесть, источник. Заведение выборки — за «+», не первым экраном.
describe('VacancyFilterPanel (B234)', () => {
  it('leads with the filters header and the search field, not with a create form', () => {
    const html = render();
    const filtersAt = html.indexOf('Фильтры');
    const savedAt = html.indexOf('Сохранённые');
    const createAt = html.indexOf('vacancy-search-create');
    expect(filtersAt).toBeGreaterThan(-1);
    expect(savedAt).toBeGreaterThan(filtersAt);
    // Форма создания свёрнута: кнопка «Создать» не рисуется, пока не нажат «+».
    expect(createAt).toBe(-1);
    expect(html).not.toContain('Настройте направление');
    expect(html).not.toContain('<span>Регулярные выборки</span>');
  });

  it('shows saved searches as pills with a plus to add one', () => {
    const html = render();
    expect(html).toContain('career-vacancy-saved');
    expect(html).toContain('Product Manager');
    expect(html).toContain('aria-label="Новый запрос к площадке"');
  });

  it('offers the role field as a filter with the campaign role as its hint', () => {
    const html = render();
    expect(html).toContain('name="vacancy-role-filter"');
    expect(html).toContain('placeholder="Xray Technician"');
    expect(html).not.toContain('Роль или поисковый запрос');
  });

  it('lists countries with counts and folds the tail behind «+N»', () => {
    const html = render();
    expect(html).toContain('Германия');
    expect(html).toContain('Россия');
    expect(html).toContain('Кипр');
    expect(html).toContain('+1');
    expect(html).not.toContain('Польша');
  });

  it('names relocation slices as rows with their count over the pool', () => {
    const html = render();
    expect(html).toContain('Условия');
    expect(html).toContain('Релокация');
    expect(html).toContain('Оплата в валюте');
    expect(html).not.toContain('Фишки работодателей');
  });
});
