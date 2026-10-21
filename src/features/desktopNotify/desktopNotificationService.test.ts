import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  listNotifications: vi.fn(),
  tauri: false,
  toggleHandler: undefined as undefined | (() => void),
  openHandler: undefined as undefined | ((event: { payload: unknown }) => void),
}));

vi.mock('@tauri-apps/api/core', () => ({
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
    mocks.openHandler = undefined;
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      setInterval: vi.fn(),
      location: { href: 'http://localhost/app?keep=1', assign: vi.fn() },
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not load state, register listeners, or request notifications without Tauri', async () => {
    const service = await import('./desktopNotificationService');
    service.startDesktopNotificationService();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });

  it('registers tray and native notification open event listeners', async () => {
    mocks.tauri = true;
    mocks.listen.mockImplementation(
      async (event: string, handler: (event: { payload: unknown }) => void) => {
        if (event === 'desktop-notify-toggle-request') mocks.toggleHandler = handler as () => void;
        if (event === 'desktop-notify-open') mocks.openHandler = handler;
        return vi.fn();
      },
    );
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
      expect(mocks.listen).toHaveBeenCalledWith('desktop-notify-open', expect.any(Function));
    });
    expect(mocks.toggleHandler).toBeTypeOf('function');
    expect(mocks.openHandler).toBeTypeOf('function');
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'log_desktop_notification_failure',
      expect.objectContaining({ context: 'register_notification_action_listener' }),
    );
  });

  it('navigates to a known target from the native notification event and ignores unknown targets', async () => {
    await startNativeService({ permission: true, requestResult: 'granted' });

    expect(mocks.openHandler).toBeTypeOf('function');
    mocks.openHandler?.({ payload: 'private-target' });
    await vi.waitFor(() => expect(window.location.assign).not.toHaveBeenCalled());

    mocks.openHandler?.({ payload: 'responses' });

    await vi.waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        'http://localhost/app?keep=1&view=responses',
      );
    });
  });

  it('requests permission, sends the native confirmation, and turns notifications off on the next click', async () => {
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
    expect(mocks.invoke).toHaveBeenCalledWith('show_desktop_notification', {
      title: 'OpenQareer',
      body: 'Уведомления openqareer включены',
      target: 'notifications',
    });

    clickToggle();

    await vi.waitFor(() => {
      expect(lastMenuUpdate()).toEqual({
        enabled: false,
        permissionStatus: 'granted',
        reason: null,
      });
    });
    expect(commandCallCount('show_desktop_notification')).toBe(1);
  });

  it('sends recruiter replies through the native notification command with their section target', async () => {
    await startNativeService({ permission: true, requestResult: 'granted' });
    mocks.listNotifications.mockResolvedValue({
      items: [
        {
          id: 'reply-1',
          kind: 'employer_reply',
          title: 'Личное название не передается',
          createdAt: new Date(Date.now() + 60_000).toISOString(),
          readAt: null,
          action: { label: 'Открыть', href: '/app?view=responses' },
        },
      ],
      unreadCount: 1,
      nextCursor: null,
    });

    clickToggle();

    await vi.waitFor(() => expect(commandCallCount('show_desktop_notification')).toBe(2));
    expect(mocks.invoke).toHaveBeenCalledWith('show_desktop_notification', {
      title: 'Ответ работодателя',
      body: 'В отклике появился новый ответ работодателя.',
      target: 'responses',
    });
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
    expect(commandCallCount('show_desktop_notification')).toBe(0);
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
        reason: 'не удалось показать тестовое уведомление: native notification unavailable',
      });
    });
    expect(mocks.invoke).toHaveBeenCalledWith('log_desktop_notification_failure', {
      context: 'send_enable_confirmation',
      reason: 'native notification unavailable',
    });
    expect(commandCallCount('show_desktop_notification')).toBe(1);
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
  mocks.listen.mockImplementation(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === 'desktop-notify-toggle-request') mocks.toggleHandler = handler as () => void;
      if (event === 'desktop-notify-open') mocks.openHandler = handler;
      return vi.fn();
    },
  );
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
    if (command === 'show_desktop_notification' && options.notificationError) {
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
