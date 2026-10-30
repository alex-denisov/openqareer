// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkedInImportStatus } from './LinkedInImportStatus';

const store = vi.hoisted(() => ({
  state: { phase: 'idle' } as Record<string, unknown>,
  showWindow: vi.fn(async () => true),
}));

vi.mock('./linkedinBackgroundImport', () => ({
  useLinkedInBackgroundImport: () => store.state,
  showLinkedInImportWindow: store.showWindow,
  dismissLinkedInBackgroundImport: vi.fn(),
}));

const roots: Array<() => void> = [];
afterEach(() => {
  roots.splice(0).forEach((done) => done());
  store.state = { phase: 'idle' };
});

function render(onSaved?: () => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<LinkedInImportStatus onSaved={onSaved} />));
  roots.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    rerender: () => act(() => root.render(<LinkedInImportStatus onSaved={onSaved} />)),
  };
}

describe('LinkedInImportStatus', () => {
  it('stays empty while nothing runs', () => {
    expect(render().container.innerHTML).toBe('');
  });

  it('says the import runs in the background, with no window to show', () => {
    store.state = { phase: 'opening' };
    const { container } = render();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'LinkedIn: импорт идёт в фоне…',
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers the window only when a person is needed', () => {
    store.state = { phase: 'needs_person', message: 'LinkedIn показывает проверку.' };
    const { container } = render();
    expect(container.textContent).toContain('LinkedIn показывает проверку.');
    act(() => container.querySelector('button')?.click());
    expect(store.showWindow).toHaveBeenCalledOnce();
  });

  it('reports the saved import once and refreshes the cabinet', () => {
    const onSaved = vi.fn();
    store.state = { phase: 'done', message: 'Из LinkedIn сохранено 3 факта.' };
    const { container, rerender } = render(onSaved);
    rerender();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Из LinkedIn сохранено 3 факта.',
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('shows a failure as an alert', () => {
    store.state = { phase: 'failed', message: 'Окно LinkedIn закрыто.' };
    const { container } = render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Окно LinkedIn закрыто.',
    );
  });
});
