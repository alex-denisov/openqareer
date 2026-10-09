// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  VacanciesFilters,
  countActiveFilters,
  type VacanciesScreenState,
} from './VacanciesScreenFilters';

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
    // 2 roles + 1 region + 1 remoteOnly + 1 selectedCity = 5
    expect(countActiveFilters(state)).toBe(5);
  });
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

  it('renders collapsed by default with «Фильтры · 0 активных»', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<VacanciesFilters {...defaultProps} />);
    });

    const toggle = container.querySelector('.vacancies-mobile-filter-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Фильтры · 0 активных');

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
    expect(toggle.textContent).toContain('Фильтры · 3 активных');
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
    act(() => root.render(<VacanciesFilters {...defaultProps} facets={{
      total: 8, regions: [{ id: 'mena', count: 8 }], remote: 0,
      levels: [], roles: [{ role: 'COO', count: 8 }], sources: [],
    }} />));
    expect(container.textContent).toContain('MENA · 8');
    expect(container.textContent).toContain('COO · 8');
    expect(container.textContent).not.toContain('Добавить:');
    expect(container.textContent).not.toContain('Backend Engineer');
    expect(container.textContent).not.toContain('Формат работы');
    expect(container.textContent).not.toContain('Уровень');
    expect(container.textContent).not.toContain('Источник');
    expect(container.querySelector('.vacancy-facet-count')?.textContent).toBe('8');
    act(() => root.unmount());
  });
});
