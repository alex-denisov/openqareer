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

  it('counts selected roles, regions, remoteOnly flag and freshnessDays', () => {
    const state: VacanciesScreenState = {
      roles: ['Backend Engineer', 'DevOps'],
      regions: ['Германия'],
      remoteOnly: true,
      freshnessDays: 7,
    };
    // 2 roles + 1 region + 1 remoteOnly + 1 freshnessDays = 5
    expect(countActiveFilters(state)).toBe(5);
  });
});

describe('VacanciesFilters mobile toggle (C74)', () => {
  const defaultProps = {
    roleHypotheses: [{ role: 'Backend Engineer', vacancyCount: 10, isHypothesis: false }],
    regions: ['Германия'],
    state: {
      roles: [],
      regions: [],
      remoteOnly: false,
    },
    onChange: vi.fn(),
    onReset: vi.fn(),
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
});
