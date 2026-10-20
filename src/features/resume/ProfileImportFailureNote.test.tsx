// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLinkedInImportProgress } from '../connections/linkedinImportProgress';
import { ProfileImportFailureNote } from './ProfileImportFailureNote';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((done) => done());
  act(() => applyLinkedInImportProgress({ type: 'start', keys: [] }));
  act(() => applyLinkedInImportProgress({ type: 'end' }));
});

function mount(onReimport = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ProfileImportFailureNote variant="desktop" onReimport={onReimport} />));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('ProfileImportFailureNote (макет 2 «Ошибка импорта»)', () => {
  it('is silent when the last walk read everything', () => {
    expect(mount().textContent).toBe('');
  });

  it('names the unread section and offers a full reread', () => {
    const onReimport = vi.fn();
    const container = mount(onReimport);
    act(() => {
      applyLinkedInImportProgress({ type: 'start', keys: ['experience', 'courses'] });
      applyLinkedInImportProgress({ type: 'read', key: 'experience' });
      applyLinkedInImportProgress({ type: 'failed', key: 'courses' });
      applyLinkedInImportProgress({ type: 'end' });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'LinkedIn: раздел «курсы» не прочитан, сайт не ответил.',
    );
    act(() => container.querySelector('button')?.click());
    expect(onReimport).toHaveBeenCalledOnce();
  });

  it('reads the failed section from the walk the server kept (B541)', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ProfileImportFailureNote
          variant="mobile"
          storedWalk={{
            platform: 'linkedin',
            state: 'done',
            updatedAt: '2026-10-20T08:00:00.000Z',
            sections: [
              { key: 'experience', status: 'read' },
              { key: 'languages', status: 'failed' },
            ],
          }}
        />,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'LinkedIn: раздел «языки» не прочитан, сайт не ответил.',
    );
    act(() => root.unmount());
    container.remove();
  });
});
