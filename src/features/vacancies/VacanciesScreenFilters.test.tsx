// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  VacanciesFilters,
  countActiveFilters,
  type VacanciesScreenState,
} from './VacanciesScreenFilters';
import { summarizeVacancyFilterGroup } from './VacanciesFilterToolbar';

describe('countActiveFilters', () => {
  it('returns 0 when state is empty', () => {
    const state: VacanciesScreenState = {
      roles: [],
      regions: [],
      remoteOnly: false,
    };
    expect(countActiveFilters(state)).toBe(0);
  });

  it('counts selected roles, regions, remoteOnly flag and selectedCity', () => {
    const state: VacanciesScreenState = {
      roles: ['Backend Engineer', 'DevOps'],
      regions: ['Германия'],
      remoteOnly: true,
      selectedCity: 'Берлин',
    };
    // Roles, locations, format, and city activate three filter groups.
    expect(countActiveFilters(state)).toBe(3);
  });
});


describe('summarizeVacancyFilterGroup', () => {
  it('shows the active location search in the location trigger', () => {
    const state: VacanciesScreenState = {
      roles: [],
      regions: [],
      remoteOnly: false,
      locationSearch: 'Berlin',
    };
    expect(summarizeVacancyFilterGroup(state, 'locations')).toBe('Berlin');
  });
});

describe('B446 filter group count', () => {
  it('counts each active group once, regardless of its selected option count', () => {
    const state = {
      roles: ['Head', 'Director'],
      regions: ['ru-central', 'ru-north-west'],
      levels: ['head'],
      sources: ['hh', 'linkedin'],
      remoteOnly: true,
      selectedCity: 'Москва',
      salaryMinimum: 450_000,
      includeMissingSalary: true,
      formats: ['hybrid', 'remote'],
    };

    expect(countActiveFilters(state)).toBe(5);
  });
});

it('shows selected values on desktop triggers and mobile filter chips', () => {
  const locations = ['Москва', ...Array.from({ length: 46 }, (_, index) => `Город ${index + 1}`)];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <VacanciesFilters
        campaignRoles={['Head', 'Director']}
        regions={[]}
        state={{
          roles: ['Head', 'Director'],
          regions: [],
          levels: [],
          sources: ['hh', 'linkedin'],
          remoteOnly: false,
          selectedLocations: locations,
          salaryMinimum: 450_000,
          salaryCurrency: '₽',
          formats: ['hybrid', 'remote'],
        }}
        locations={locations.map((label) => ({ id: label, label, count: 1 }))}
        salaryCurrencies={['₽']}
        formatCounts={{ hybrid: 88, remote: 36, office: 41, unknown: 0 }}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onAddCustomRole={vi.fn().mockResolvedValue(true)}
      />,
    );
  });

  expect(container.querySelector('[data-filter-group="roles"]')?.textContent).toContain(
    'Head, Director',
  );
  expect(container.querySelector('[data-filter-group="locations"]')?.textContent).toContain(
    'Москва +46',
  );
  expect(container.querySelector('[data-filter-group="salary"]')?.textContent).toContain(
    'от 450 тыс. ₽',
  );
  expect(container.querySelector('[data-filter-group="format"]')?.textContent).toContain('2');
  expect(container.querySelector('[data-filter-group="sources"]')?.textContent).toContain('2');
  expect(container.querySelectorAll('.vacancies-mobile-filter-chip')).toHaveLength(5);
  expect(container.textContent).not.toContain('Сохранённые поиски');

  act(() => root.unmount());
  container.remove();
});

describe('VacanciesFilters toggle and role limit', () => {
  const defaultProps = {
    roleHypotheses: [{ role: 'Backend Engineer', vacancyCount: 10, isHypothesis: false }],
    campaignRoles: ['Backend Engineer'],
    regions: ['Германия'],
    state: {
      roles: [],
      regions: [],
      remoteOnly: false,
    },
    onChange: vi.fn(),
    onReset: vi.fn(),
    onAddCustomRole: vi.fn().mockResolvedValue(true),
  };

  it('renders collapsed by default with «Фильтры 0»', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<VacanciesFilters {...defaultProps} />);
    });

    const toggle = container.querySelector('.vacancies-mobile-filter-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Фильтры 0');
    for (const label of ['Роли', 'Локации', 'Зарплата', 'Формат', 'Источники']) {
      expect(container.textContent).toContain(label);
    }

    const aside = container.querySelector('.vacancies-filters') as HTMLElement;
    expect(aside.classList.contains('is-mobile-open')).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it('toggles expanded state on click and updates aria-expanded', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <VacanciesFilters
          {...defaultProps}
          state={{
            roles: ['Backend Engineer'],
            regions: ['Германия'],
            remoteOnly: true,
          }}
        />,
      );
    });

    const toggle = container.querySelector('.vacancies-mobile-filter-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Фильтры 3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const aside = container.querySelector('.vacancies-filters') as HTMLElement;
    expect(aside.classList.contains('is-mobile-open')).toBe(true);

    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(aside.classList.contains('is-mobile-open')).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it('renders only result facets with tabular counts and hides empty groups', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() =>
      root.render(
        <VacanciesFilters
          {...defaultProps}
          facets={{
            total: 8,
            regions: [{ id: 'mena', count: 8 }],
            remote: 0,
            levels: [],
            roles: [{ role: 'COO', count: 8 }],
            sources: [],
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('MENA · 8');
    expect(container.textContent).toContain('COO · 8');
    expect(container.textContent).not.toContain('Добавить:');
    expect(container.textContent).not.toContain('Backend Engineer');
    expect(container.textContent).not.toContain('Формат работы');
    expect(container.textContent).not.toContain('Уровень');
    expect(container.querySelector('.vacancy-source-filter')).toBeNull();
    expect(container.querySelector('.vacancy-facet-count')?.textContent).toBe('8');
    act(() => root.unmount());
  });
});
