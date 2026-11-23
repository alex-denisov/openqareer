// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBellCount, type BellState } from './useBellCount';

const legacy = vi.hoisted(() => ({ listNotifications: vi.fn() }));
const feed = vi.hoisted(() => ({ listB640Notifications: vi.fn() }));
vi.mock('../../notifications/notificationsApi', () => legacy);
vi.mock('../today/b640NotificationsApi', () => feed);

const page = (pinned: number) => ({
  items: [],
  pinned: Array.from({ length: pinned }, (_, index) => ({ id: `p${index}` })),
  unreadCount: 3,
  nextCursor: null,
});

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.clearAllMocks();
});

async function mount(path: string): Promise<BellState> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let state: BellState | undefined;
  function Harness() {
    state = useBellCount(path);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness />));
  return state!;
}

describe('useBellCount (n01: счётчик колокольчика)', () => {
  it('важное непрочитанное делает счётчик критическим', async () => {
    legacy.listNotifications.mockResolvedValue({ items: [], unreadCount: 3 });
    feed.listB640Notifications.mockResolvedValue(page(1));
    expect(await mount('/app/today')).toEqual({ count: 3, critical: true });
  });

  it('без важного — обычный счётчик', async () => {
    legacy.listNotifications.mockResolvedValue({ items: [], unreadCount: 3 });
    feed.listB640Notifications.mockResolvedValue(page(0));
    expect(await mount('/app/today')).toEqual({ count: 3, critical: false });
  });

  it('сбой ленты не красит счётчик', async () => {
    legacy.listNotifications.mockResolvedValue({ items: [], unreadCount: 2 });
    feed.listB640Notifications.mockRejectedValue(new Error('offline'));
    expect(await mount('/app/vacancies')).toEqual({ count: 2, critical: false });
  });
});
