import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../services/desktop/desktopBridge', () => ({ invokeDesktopCommand: invoke }));

import { getDeviceSettings, saveDeviceSettings } from './deviceSettingsApi';
import { trayIconTitle } from './DeviceSettingsSection';

const stored = { trayIcon: true, autoUpdate: true };
function answer(launch: boolean) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_device_settings') return stored;
    if (command === 'plugin:autostart|is_enabled') return launch;
    return null;
  });
}

afterEach(() => invoke.mockReset());

describe('B722: настройки этого компьютера', () => {
  it('reads the file settings and the launch-at-login state from the OS', async () => {
    answer(true);
    expect(await getDeviceSettings()).toEqual({ trayIcon: true, autoUpdate: true, launchAtLogin: true });
  });

  it('refuses a malformed answer instead of guessing', async () => {
    invoke.mockResolvedValue({ trayIcon: 'yes' });
    await expect(getDeviceSettings()).rejects.toThrow('device_settings_invalid');
  });

  it('launch at login goes to the autostart plugin, other fields to the settings file', async () => {
    answer(false);
    await saveDeviceSettings({ launchAtLogin: true });
    expect(invoke).toHaveBeenCalledWith('plugin:autostart|enable');
    expect(invoke).not.toHaveBeenCalledWith('save_device_settings', expect.anything());
    await saveDeviceSettings({ trayIcon: false });
    expect(invoke).toHaveBeenCalledWith('save_device_settings', { patch: { trayIcon: false } });
    await saveDeviceSettings({ launchAtLogin: false });
    expect(invoke).toHaveBeenCalledWith('plugin:autostart|disable');
  });

  it('names the icon place the way each system does', () => {
    expect(trayIconTitle('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Значок в строке меню');
    expect(trayIconTitle('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Значок в области уведомлений');
  });
});
