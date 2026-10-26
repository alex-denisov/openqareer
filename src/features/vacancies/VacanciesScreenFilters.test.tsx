// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  VacanciesFilters,
  countActiveFilters,
  type VacanciesScreenState,
} from './VacanciesScreenFilters';
import {
  VacanciesFilterToolbarFromState,
  summarizeVacancyFilterGroup,
  withCampaignDefaults,
} from './VacanciesFilterToolbar';

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

  it('names two regions and counts the rest, never drops them silently', () => {
    const state: VacanciesScreenState = {
      roles: [],
      regions: ['ru', 'cis', 'us', 'eu', 'mena'],
      remoteOnly: false,
    };
    expect(summarizeVacancyFilterGroup(state, 'locations')).toBe('Россия, СНГ +3');
    expect(summarizeVacancyFilterGroup({ ...state, regions: ['ru', 'cis'] }, 'locations')).toBe(
      'Россия, СНГ',
    );
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

  // CPO 26.10: кнопка «Роли · N», названия — в чипе 390 и выпадающем списке.
  expect(container.querySelector('[data-filter-group="roles"]')?.textContent).toBe('Роли · 2');
  expect(container.querySelector('.vacancies-mobile-filter-chip')?.textContent).toBe(
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
    // B446-g4: роли и регионы кампании считаются заданными фильтрами (макет 4: «Фильтры 5»).
    expect(toggle.textContent).toMatch(/Фильтры [1-9]/u);
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

  it('roles popover lists campaign roles with counts, no level or chips (B547)', () => {
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
            roles: [{ role: 'Backend Engineer', count: 8 }],
            sources: [],
          }}
        />,
      ),
    );
    const roles = container.querySelector('[data-testid="role-tree-filter"]');
    expect(roles?.textContent).toContain('Backend Engineer');
    expect(roles?.querySelector('.vacancy-location-count')?.textContent).toBe('8');
    expect(container.textContent).not.toContain('MENA · 8');
    expect(container.textContent).not.toContain('Уровень');
    expect(container.textContent).not.toContain('Добавить свою роль');
    expect(container.querySelector('.vacancy-source-filter')).toBeNull();
    act(() => root.unmount());
  });
});

describe('withCampaignDefaults (B446-g4)', () => {
  const empty = { roles: [], regions: [], remoteOnly: false };
  it('shows campaign roles and regions on the buttons when nothing is picked by hand', () => {
    const shown = withCampaignDefaults(empty, ['Head of Engineering', 'Director'], ['ru']);
    expect(summarizeVacancyFilterGroup(shown, 'roles')).toBe('Head of Engineering +1');
    expect(summarizeVacancyFilterGroup(shown, 'locations')).toBeTruthy();
  });
  it('keeps a hand-picked choice over the campaign', () => {
    const shown = withCampaignDefaults({ ...empty, roles: ['CTO'] }, ['Head'], []);
    expect(summarizeVacancyFilterGroup(shown, 'roles')).toBe('CTO');
  });
});

describe('«Карьера» geography in «Локации» (CPO 26.10)', () => {
  const empty = { roles: [], regions: [], remoteOnly: false };
  const career = { places: ['Россия › Центральный › Москва'], remote: true };
  it('names the «Карьера» cities instead of the wizard regions', () => {
    const shown = withCampaignDefaults(empty, [], ['ru', 'cis', 'eu', 'mena'], career);
    expect(summarizeVacancyFilterGroup(shown, 'locations')).toBe('Москва +1');
    expect(shown.selectedLocations).toEqual(career.places);
    expect(shown.locationRemote).toBe(true);
  });
  it('keeps the wizard regions when «Карьера» names no place', () => {
    const shown = withCampaignDefaults(empty, [], ['ru', 'cis']);
    expect(summarizeVacancyFilterGroup(shown, 'locations')).toBe('Россия, СНГ');
  });
});

describe('roles button «Роли · N» (CPO 26.10)', () => {
  it('shows the role count on the desktop button and keeps names in the label', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const roles = [
      'VP of Engineering',
      'Head of Engineering',
      'CTO',
      'Director of Engineering',
      'Engineering Manager',
    ];
    act(() =>
      root.render(
        <VacanciesFilterToolbarFromState
          state={{ roles, regions: [], remoteOnly: false }}
          expanded={false}
          activeGroup={null}
          onToggle={() => undefined}
          onSelectGroup={() => undefined}
        />,
      ),
    );
    const button = container.querySelector('[data-filter-group="roles"]')!;
    expect(button.querySelector('.vacancies-filter-group-text')?.textContent).toBe('Роли · 5');
    expect(button.getAttribute('aria-label')).toBe(`Роли: ${roles.join(', ')}`);
    act(() => root.unmount());
  });
});

describe('role summary short form (B446-g4)', () => {
  const empty = { roles: [], regions: [], remoteOnly: false };
  it('shortens roles that differ only by the level prefix', () => {
    const state = { ...empty, roles: ['Head of Engineering', 'Director of Engineering'] };
    expect(summarizeVacancyFilterGroup(state, 'roles')).toBe('Head, Director');
  });
  it('otherwise names the first role and how many more', () => {
    const state = { ...empty, roles: ['Head of Engineering', 'CTO', 'VP Product'] };
    expect(summarizeVacancyFilterGroup(state, 'roles')).toBe('Head of Engineering +2');
    expect(summarizeVacancyFilterGroup({ ...empty, roles: ['CTO'] }, 'roles')).toBe('CTO');
  });
});
