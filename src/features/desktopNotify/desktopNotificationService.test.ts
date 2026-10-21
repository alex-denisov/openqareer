import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  listNotifications: vi.fn(),
  tauri: false,
  toggleHandler: undefined as undefined | (() => void),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: mocks.addPluginListener,
  invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../notifications/notificationsApi', () => ({ listNotifications: mocks.listNotifications }));
vi.mock('../../services/desktop/desktopBridge', () => ({
  isTauriEnvironment: () => mocks.tauri,
}));

describe('desktopNotificationService in the browser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.tauri = false;
    mocks.toggleHandler = undefined;
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      setInterval: vi.fn(),
      location: { href: 'http://localhost/' },
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not load state, register listeners, or request notifications without Tauri', async () => {
    const service = await import('./desktopNotificationService');
    service.startDesktopNotificationService();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.addPluginListener).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });

  it('registers the tray toggle handler even when notification action registration fails', async () => {
    mocks.tauri = true;
    mocks.addPluginListener.mockRejectedValue(new Error('notification action listener failed'));
    mocks.listen.mockImplementation(async (_event: string, handler: () => void) => {
      mocks.toggleHandler = handler;
      return vi.fn();
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_desktop_notification_state') {
        return {
          enabled: false,
          enabledAt: null,
          lastPollAt: null,
          seenIds: [],
          permissionStatus: 'unknown',
        };
      }
      return undefined;
    });

    await import('./desktopNotificationService');

    await vi.waitFor(() => {
      expect(mocks.listen).toHaveBeenCalledWith(
        'desktop-notify-toggle-request',
        expect.any(Function),
      );
    });
    expect(mocks.toggleHandler).toBeTypeOf('function');
    expect(mocks.invoke).toHaveBeenCalledWith('log_desktop_notification_failure', {
      context: 'register_notification_action_listener',
      reason: 'notification action listener failed',
    });
  });

  it('requests plugin permission, enables notifications with a test alert, and turns them off on the next click', async () => {
    await startNativeService({ permission: null, requestResult: 'granted' });

    clickToggle();

    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('plugin:notification|request_permission');
    expect(commandCallCount('request_desktop_notification_permission')).toBe(1);
      expect(lastMenuUpdate()).toEqual({
        enabled: true,
        permissionStatus: 'granted',
        reason: null,
      });
    });
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:notification|notify', {
      options: { title: 'OpenQareer', body: 'Уведомления openqareer включены' },
    });

    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'granted',
        reason: null,
      });
    });
    expect(commandCallCount('plugin:notification|notify')).toBe(1);
  });

  it('shows denied permission after a refusal and does not request permission again', async () => {
    await startNativeService({ permission: null, requestResult: 'denied' });

    clickToggle();
    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'denied',
        reason: null,
      });
    });
    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'denied',
        reason: null,
      });
    });
    expect(commandCallCount('plugin:notification|request_permission')).toBe(1);
    expect(commandCallCount('request_desktop_notification_permission')).toBe(1);
    expect(commandCallCount('plugin:notification|notify')).toBe(0);
  });

  it('shows an unavailable reason and logs permission IPC errors', async () => {
    let permissionCalls = 0;
    await startNativeService({
      permission: null,
      requestResult: 'granted',
      permissionForCall: (call) => {
        if (call === 2) throw new Error('permission IPC unavailable');
        return null;
      },
      nextPermissionCall: () => {
        permissionCalls += 1;
      },
    });

    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'unavailable',
        reason: 'не удалось изменить настройку',
      });
    });
    expect(mocks.invoke).toHaveBeenCalledWith('log_desktop_notification_failure', {
      context: 'toggle_notifications',
      reason: 'permission IPC unavailable',
    });
    expect(commandCallCount('plugin:notification|request_permission')).toBe(0);
    expect(permissionCalls).toBe(2);
  });

  it('does not leave notifications enabled when the test alert fails', async () => {
    await startNativeService({
      permission: null,
      requestResult: 'granted',
      notificationError: new Error('native notification unavailable'),
    });

    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'unavailable',
        reason: 'не удалось показать тестовое уведомление',
      });
    });
    expect(mocks.invoke).toHaveBeenCalledWith('log_desktop_notification_failure', {
      context: 'send_enable_confirmation',
      reason: 'native notification unavailable',
    });
    expect(commandCallCount('plugin:notification|notify')).toBe(1);
  });

  it('uses native macOS denial when the Tauri plugin reports granted', async () => {
    await startNativeService({
      permission: true,
      pluginPermission: true,
      nativePermissionStatus: 'denied',
      requestResult: 'granted',
    });

    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'denied',
        reason: null,
      });
    });
    expect(commandCallCount('get_desktop_notification_permission_state')).toBeGreaterThan(0);
    expect(commandCallCount('plugin:notification|is_permission_granted')).toBeGreaterThan(0);
    expect(mocks.invoke).toHaveBeenCalledWith('log_desktop_notification_failure', {
      context: 'plugin_permission_state_mismatch',
      reason: 'Tauri plugin reported true; macOS reported false',
    });
    expect(commandCallCount('plugin:notification|request_permission')).toBe(0);
    expect(commandCallCount('request_desktop_notification_permission')).toBe(0);
    expect(commandCallCount('plugin:notification|notify')).toBe(0);
  });
});

interface TestState {
  readonly enabled: boolean;
  readonly enabledAt: string | null;
  readonly lastPollAt: string | null;
  readonly seenIds: readonly string[];
  readonly permissionStatus: string;
  readonly permissionReason: string | null;
}

interface NativeServiceOptions {
  readonly permission: boolean | null;
  readonly pluginPermission?: boolean | null;
  readonly nativePermissionStatus?: string;
  readonly requestResult: string;
  readonly notificationError?: Error;
  readonly permissionForCall?: (call: number) => boolean | null;
  readonly nextPermissionCall?: () => void;
}

async function startNativeService(options: NativeServiceOptions): Promise<void> {
  mocks.tauri = true;
  mocks.addPluginListener.mockResolvedValue(vi.fn());
  mocks.listen.mockImplementation(async (event: string, handler: () => void) => {
    if (event === 'desktop-notify-toggle-request') mocks.toggleHandler = handler;
    return vi.fn();
  });
  mocks.listNotifications.mockResolvedValue({ items: [], nextCursor: null });
  let storedState: TestState = {
    enabled: false,
    enabledAt: null,
    lastPollAt: null,
    seenIds: [],
    permissionStatus: 'unknown',
    permissionReason: null,
  };
  let permission = options.permission;
  let permissionCall = 0;
  mocks.invoke.mockImplementation(async (command: string, args?: { state?: TestState }) => {
    if (command === 'get_desktop_notification_state') return storedState;
    if (command === 'get_desktop_notification_permission_state') {
      permissionCall += 1;
      options.nextPermissionCall?.();
      const permissionOverride = options.permissionForCall?.(permissionCall);
      return options.nativePermissionStatus ?? permissionStatus(permissionOverride ?? permission);
    }
    if (command === 'plugin:notification|is_permission_granted') {
      return options.pluginPermission === undefined ? true : options.pluginPermission;
    }
    if (command === 'plugin:notification|request_permission') {
      return 'granted';
    }
    if (command === 'request_desktop_notification_permission') {
      permission = options.requestResult === 'granted' ? true : false;
      return options.requestResult;
    }
    if (command === 'plugin:notification|notify' && options.notificationError) {
      throw options.notificationError;
    }
    if (command === 'save_desktop_notification_state' && args?.state) {
      storedState = args.state;
    }
    return undefined;
  });

  await import('./desktopNotificationService');
  await vi.waitFor(() => {
    expect(mocks.listen).toHaveBeenCalledWith(
      'desktop-notify-toggle-request',
      expect.any(Function),
    );
    expect(commandCallCount('update_desktop_notification_menu_state')).toBeGreaterThan(0);
  });
}

function clickToggle(): void {
  expect(mocks.toggleHandler).toBeTypeOf('function');
  mocks.toggleHandler?.();
}

function lastMenuUpdate(): unknown {
  const updates = mocks.invoke.mock.calls.filter(
    ([command]) => command === 'update_desktop_notification_menu_state',
  );
  return updates.at(-1)?.[1];
}

function commandCallCount(command: string): number {
  return mocks.invoke.mock.calls.filter(([name]) => name === command).length;
}

function permissionStatus(permission: boolean | null): string {
  if (permission === true) return 'granted';
  if (permission === false) return 'denied';
  return 'unknown';
}
