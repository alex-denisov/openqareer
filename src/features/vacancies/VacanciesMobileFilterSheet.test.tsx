// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { mobileFilterValues } from './VacanciesFilterPopover';
import { MobileFilterSheet, showResultsLabel } from './VacanciesMobileFilterSheet';

const state = {
  roles: ['Head', 'Director'],
  regions: [],
  remoteOnly: false,
  selectedLocations: ['Москва', ...Array.from({ length: 46 }, (_, i) => `Город ${i + 1}`)],
  salaryMinimum: 450_000,
  salaryCurrency: '₽',
  formats: ['hybrid', 'remote'],
  sources: ['hh', 'linkedin'],
};

describe('mobile filter sheet', () => {
  it('names the selected values of every group like the mockup', () => {
    expect(mobileFilterValues(state, 1200)).toEqual({
      roles: 'Head, Director',
      locations: 'Москва +46',
      salary: 'от 450 тыс. ₽',
      format: 'Гибрид, удалённо',
      sources: `2 из ${new Intl.NumberFormat('ru-RU').format(1200)}`,
    });
  });

  it('shows the count only when it is known', () => {
    expect(showResultsLabel(148)).toBe('Показать 148');
    expect(showResultsLabel(undefined)).toBe('Показать результаты');
  });

  it('opens a group as a push screen and comes back', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onSelectGroup = vi.fn();
    const onBack = vi.fn();
    const render = (activeGroup: 'locations' | null) =>
      act(() =>
        root.render(
          <MobileFilterSheet
            activeGroup={activeGroup}
            values={mobileFilterValues(state, 1200)}
            resultCount={148}
            onSelectGroup={onSelectGroup}
            onBack={onBack}
            onReset={vi.fn()}
            onShow={vi.fn()}
          >
            <p>tree</p>
          </MobileFilterSheet>,
        ),
      );
    render(null);
    expect(container.querySelectorAll('[data-filter-sheet-group]')).toHaveLength(5);
    expect(container.textContent).toContain('Показать 148');
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-filter-sheet-group="locations"]')!.click(),
    );
    expect(onSelectGroup).toHaveBeenCalledWith('locations');
    render('locations');
    expect(container.querySelector('h3')?.textContent).toBe('Локации');
    expect(container.textContent).toContain('tree');
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Назад к фильтрам"]')!.click(),
    );
    expect(onBack).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
