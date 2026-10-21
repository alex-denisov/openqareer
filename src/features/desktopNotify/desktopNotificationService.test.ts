import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  listNotifications: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: mocks.addPluginListener,
  invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../notifications/notificationsApi', () => ({ listNotifications: mocks.listNotifications }));
vi.mock('../../services/desktop/desktopBridge', () => ({ isTauriEnvironment: () => false }));

describe('desktopNotificationService in the browser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not load state, register listeners, or request notifications without Tauri', async () => {
    const service = await import('./desktopNotificationService');
    service.startDesktopNotificationService();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.addPluginListener).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });
});
