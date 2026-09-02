import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SavedSearchesPanel } from './SavedSearchesPanel';
import type { VacancySubscription } from '../coach/coachApi';

const subscription: VacancySubscription = {
  id: 'sub-1',
  source: 'hh',
  query: 'Руководитель продукта',
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

function render(subscriptions: VacancySubscription[]) {
  return renderToStaticMarkup(
    <SavedSearchesPanel
      subscriptions={subscriptions}
      defaultQuery="Руководитель продукта"
      onRefresh={vi.fn(async () => undefined)}
    />,
  );
}

describe('SavedSearchesPanel', () => {
  it('называет раздел так же, как кандидат его ищет — регулярные выборки', () => {
    expect(render([])).toContain('Регулярные выборки');
  });

  it('без выборок предлагает завести первую прямо в панели фильтров', () => {
    const html = render([]);
    expect(html).toContain('Источник вакансий');
    expect(html).toContain('Роль или поисковый запрос');
    expect(html).toContain('vacancy-search-create');
  });

  it('показывает заведённую выборку с её запросом и размером выборки', () => {
    const html = render([subscription]);
    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('41');
    expect(html).toContain('Активен');
  });
});
