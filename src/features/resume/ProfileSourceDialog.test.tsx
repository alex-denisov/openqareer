// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateConnection, ImportWalk } from '../coach/coachApi';
import { ProfileSourceDialog, importSummary } from './ProfileSourceDialog';

const api = vi.hoisted(() => ({ disconnectConnection: vi.fn() }));
vi.mock('../coach/coachApi', () => api);

const connected: CandidateConnection = {
  platform: 'linkedin',
  available: true,
  capabilities: ['profile_read'],
  importsCareerHistory: true,
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-09-10T08:00:00.000Z',
  lastImportedAt: '2026-09-12T08:00:00.000Z',
  factCount: 9,
};

const roots: Array<() => void> = [];
afterEach(() => roots.splice(0).forEach((done) => done()));

function render(onOpenConnections = vi.fn(), walk?: ImportWalk) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProfileSourceDialog
        platform="linkedin"
        connection={connected}
        factCount={9}
        importedAt="2026-09-12T08:00:00.000Z"
        isOpen
        onClose={vi.fn()}
        walk={walk}
        onOpenConnections={onOpenConnections}
      />,
    ),
  );
  roots.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return document.body;
}

const button = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );

describe('ProfileSourceDialog (макет 2 «Модальное окно: источник»)', () => {
  it('states the connection and what was imported', () => {
    const body = render();
    expect(body.textContent).toContain('Подключено');
    expect(body.textContent).toContain('с 10.09');
    expect(body.textContent).toContain('Импортировано 9 из 9 фактов, 12.09.');
  });

  it('disconnects only after confirmation and keeps imported facts', async () => {
    api.disconnectConnection.mockResolvedValue({});
    render();
    act(() => button('Отключить')?.click());
    expect(api.disconnectConnection).not.toHaveBeenCalled();
    await act(async () => button('Да, отключить')?.click());
    expect(api.disconnectConnection).toHaveBeenCalledWith('linkedin');
    expect(document.body.textContent).toContain('Импортированные факты остались в профиле.');
    expect(button('Отключить')).toBeUndefined();
  });

  it('reports a failed disconnect honestly', async () => {
    api.disconnectConnection.mockRejectedValue(new Error('offline'));
    render();
    act(() => button('Отключить')?.click());
    await act(async () => button('Да, отключить')?.click());
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось отключить',
    );
  });

  it('reimport goes to the real connection flow', () => {
    const onOpenConnections = vi.fn();
    render(onOpenConnections);
    act(() => button('Импортировать заново')?.click());
    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('says plainly when nothing was imported', () => {
    expect(importSummary(undefined, undefined)).toBe('Импорта из этого источника ещё не было.');
    expect(importSummary(9, '2026-10-07T08:00:00.000Z', 8)).toBe(
      'Импортировано 8 из 9 фактов, 07.10.',
    );
    expect(importSummary(4, '2026-10-07T08:00:00.000Z')).toBe(
      'Импортировано 4 из 4 фактов, 07.10.',
    );
    expect(importSummary(21, '2026-10-07T08:00:00.000Z')).toBe(
      'Импортировано 21 из 21 факта, 07.10.',
    );
  });

  it('lists unread sections quietly and retries by rereading the source (C6)', () => {
    const onOpenConnections = vi.fn();
    const body = render(onOpenConnections, {
      platform: 'linkedin',
      state: 'done',
      updatedAt: '2026-10-23T08:00:00.000Z',
      sections: [
        ...Array.from({ length: 7 }, (_, index) => ({
          key: `k${index}`,
          status: 'read' as const,
        })),
        { key: 'contactInfo', status: 'failed' },
      ],
    });
    expect(body.textContent).toContain('Прочитано разделов: 7 из 8');
    expect(body.textContent).toContain('Раздел «контакты» не прочитан');
    act(() => button('Повторить раздел')?.click());
    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('shows no unread line when every section was read', () => {
    const body = render(vi.fn(), {
      platform: 'linkedin',
      state: 'done',
      updatedAt: '2026-10-23T08:00:00.000Z',
      sections: [{ key: 'experience', status: 'read' }],
    });
    expect(body.textContent).not.toContain('не прочитан');
    expect(button('Повторить раздел')).toBeUndefined();
  });
});
