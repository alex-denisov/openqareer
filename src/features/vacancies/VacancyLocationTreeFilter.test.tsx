// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLocationTree } from '../../../shared/locationTree';
import { DECISION_PROFILE_STORAGE_KEY } from '../../../shared/workPreferences';
import { VacancyLocationTreeFilter } from './VacancyLocationTreeFilter';
import type { VacanciesScreenState } from './vacanciesScreenState';

vi.mock('../coach/coachApi', () => ({ putDecisionProfile: vi.fn().mockResolvedValue(undefined) }));

const tree = buildLocationTree([
  { location: 'Москва' },
  { location: 'Тверь' },
  { location: 'Санкт-Петербург' },
  { location: 'New York, NY, United States' },
  { location: 'New York, NY, United States' },
  { location: 'Jersey City, New Jersey, United States' },
  { location: 'New Orleans, LA, United States' },
  { location: 'Remote', isRemote: true },
]);

let latest: VacanciesScreenState = { roles: [], regions: [], remoteOnly: false };

function Harness({ onCancel }: { readonly onCancel: () => void }) {
  const [state, setState] = useState<VacanciesScreenState>(latest);
  latest = state;
  return (
    <VacancyLocationTreeFilter
      state={state}
      tree={tree}
      onChange={(updater) => setState(updater)}
      onCancel={onCancel}
      onApply={vi.fn()}
    />
  );
}

function render(onCancel = vi.fn()) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Harness onCancel={onCancel} />));
  return { container, root };
}

function checkbox(container: HTMLElement, label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll('label')).find(
    (node) => node.textContent?.trim() === label,
  );
  return found!.querySelector('input')!;
}

afterEach(() => {
  latest = { roles: [], regions: [], remoteOnly: false };
  window.localStorage.clear();
});

describe('VacancyLocationTreeFilter', () => {
  it('checking a federal district selects its cities and marks the country mixed', () => {
    const { container, root } = render();
    act(() => checkbox(container, 'Центральный ФО').click());
    expect(checkbox(container, 'Москва').checked).toBe(true);
    expect(checkbox(container, 'Россия').indeterminate).toBe(true);
    expect(latest.selectedLocations).toEqual(['Россия › Центральный ФО']);
    // B446-r: «Выбрано» — вакансии (как «Выбрано 47» в макете), а не строки.
    expect(container.textContent).toContain('Выбрано 2');
    act(() => root.unmount());
  });

  it('search shows hits with their path', () => {
    const { container, root } = render();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'нью');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const hits = Array.from(container.querySelectorAll('.vacancy-location-hit')).map(
      (node) => node.textContent,
    );
    expect(hits).toHaveLength(4);
    expect(hits[0]).toContain('США › штат Нью-Йорк');
    expect(container.textContent).toContain('Найдено 4 по «нью»');
    act(() => root.unmount());
  });

  it('other countries stay disabled until relocation is enabled', () => {
    const { container, root } = render();
    expect(checkbox(container, 'США').disabled).toBe(true);
    const enable = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Включить',
    )!;
    act(() => enable.click());
    expect(checkbox(container, 'США').disabled).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(DECISION_PROFILE_STORAGE_KEY)!);
    expect(stored.workFormats).toContain('relocation');
    act(() => root.unmount());
  });

  it('remote row and Cancel', () => {
    const onCancel = vi.fn();
    const { container, root } = render(onCancel);
    act(() => checkbox(container, 'Удалённо, из любой страны').click());
    expect(latest.locationRemote).toBe(true);
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Отмена',
    )!;
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});

describe('VacancyLocationTreeFilter footer (B510, mockup 4 .pop-foot)', () => {
  it('uses ghost small buttons for secondary actions and a small button for apply', () => {
    const { container, root } = render();
    const byText = (text: string) =>
      Array.from(container.querySelectorAll('.vacancy-location-foot button')).find(
        (node) => node.textContent?.trim() === text,
      )!;
    expect(byText('Снять все').className).toBe('vac-sm is-ghost');
    expect(byText('Отмена').className).toBe('vac-sm is-ghost');
    expect(byText('Применить').className).toBe('vac-sm vacancies-filter-apply');
    act(() => root.unmount());
  });
});
