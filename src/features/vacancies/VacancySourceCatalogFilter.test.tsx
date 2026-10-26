// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { VacancySourceCatalogFilter } from './VacancySourceCatalogFilter';
import type { VacanciesScreenState } from './vacanciesScreenState';

const catalog = [
  { id: 'greenhouse', name: 'Greenhouse', category: 'ATS компаний', market: 'США' },
  { id: 'lever', name: 'Lever', category: 'ATS компаний', market: 'США' },
  { id: 'hh', name: 'hh.ru', category: 'Международные площадки', market: 'Россия' },
];

vi.mock('../coach/coachApi', () => ({
  getVacancySources: () => Promise.resolve(catalog),
  getCatalogSourceList: () => Promise.resolve([]),
}));

const facets = {
  total: 834,
  regions: [],
  remote: 0,
  levels: [],
  roles: [],
  sources: [
    { sourceId: 'greenhouse', name: 'Greenhouse', count: 722 },
    { sourceId: 'hh', name: 'hh.ru', count: 112 },
  ],
};

let latest: VacanciesScreenState = { roles: [], regions: [], remoteOnly: false };

function Harness() {
  const [state, setState] = useState(latest);
  latest = state;
  return (
    <VacancySourceCatalogFilter
      state={state}
      facets={facets}
      onChange={setState}
      withFooter
      onCancel={vi.fn()}
      onApply={vi.fn()}
    />
  );
}

describe('sources popover (B547 / B447)', () => {
  it('counts sources per category, not vacancies, and selects a whole category', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    const category = (name: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.vacancy-source-category')).find(
        (button) => button.textContent?.startsWith(name),
      )!;
    expect(category('Все').textContent).toBe('Все3');
    expect(category('ATS компаний').textContent).toBe('ATS компаний2');
    await act(async () => category('ATS компаний').click());
    const all = Array.from(container.querySelectorAll('label')).find((label) =>
      label.textContent?.startsWith('Все в «ATS компаний»'),
    )!;
    await act(async () => all.querySelector('input')!.click());
    expect(latest.sources).toEqual(['greenhouse', 'lever']);
    expect(container.textContent).toContain('Выбрано 2 из 3');
    expect(container.textContent).toContain('США');
    await act(async () => root.unmount());
  });
});
