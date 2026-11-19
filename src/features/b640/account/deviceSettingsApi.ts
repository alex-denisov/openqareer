import { invokeDesktopCommand } from '../../../services/desktop/desktopBridge';

/** B722: настройки этого компьютера из n06 «Приложение»; хранит приложение, не сервер. */
export interface DeviceSettings {
  readonly trayIcon: boolean;
  readonly autoUpdate: boolean;
  readonly launchAtLogin: boolean;
}

type StoredSettings = Omit<DeviceSettings, 'launchAtLogin'>;
export type DeviceSettingsPatch = Partial<DeviceSettings>;

function storedSettings(value: unknown): StoredSettings {
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof record.trayIcon !== 'boolean' || typeof record.autoUpdate !== 'boolean') {
    throw new Error('device_settings_invalid');
  }
  return { trayIcon: record.trayIcon, autoUpdate: record.autoUpdate };
}

async function launchAtLogin(): Promise<boolean> {
  return (await invokeDesktopCommand<boolean>('plugin:autostart|is_enabled')) === true;
}

export async function getDeviceSettings(): Promise<DeviceSettings> {
  const [stored, autostart] = await Promise.all([
    invokeDesktopCommand<unknown>('get_device_settings'),
    launchAtLogin(),
  ]);
  return { ...storedSettings(stored), launchAtLogin: autostart };
}

/** Меняет одно поле; ответ — настройки после сохранения (из файла и из ОС). */
export async function saveDeviceSettings(patch: DeviceSettingsPatch): Promise<DeviceSettings> {
  if (patch.launchAtLogin !== undefined) {
    await invokeDesktopCommand(patch.launchAtLogin ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
  }
  const { launchAtLogin: _ignored, ...stored } = patch;
  if (Object.keys(stored).length > 0) {
    await invokeDesktopCommand('save_device_settings', { patch: stored });
  }
  return getDeviceSettings();
}
