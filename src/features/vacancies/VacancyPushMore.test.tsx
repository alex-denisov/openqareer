// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { VacancyPushMore } from './VacancyPushMore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

it('opens «Ещё» as a sheet and runs the chosen row action once (B510)', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const onSchedule = vi.fn();
  const root = createRoot(host);
  act(() =>
    root.render(
      <VacancyPushMore actions={[{ label: 'Назначили интервью', onSelect: onSchedule }]} />,
    ),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => button(host, 'Ещё').click());
  expect(host.querySelector('[role="dialog"][aria-label="Ещё"]')).not.toBeNull();
  act(() => button(host, 'Назначили интервью').click());
  expect(onSchedule).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.unmount());
});

it('renders nothing when the vacancy has no secondary actions', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<VacancyPushMore actions={[]} />));
  expect(host.innerHTML).toBe('');
  act(() => root.unmount());
});
