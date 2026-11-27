// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { AppScreen } from './AppScreen';

vi.mock('../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<typeof import('../../../services/desktop/desktopBridge')>()),
  isTauriEnvironment: () => true,
}));
const updater = vi.hoisted(() => {
  const idle = { state: 'idle', info: { version: '' } };
  return { check: vi.fn(async () => 'latest'), getStatus: () => idle, subscribe: () => () => undefined, setAutoInstall: vi.fn(), actions: {} };
});
vi.mock('../../appUpdate/useDesktopUpdater', () => ({ desktopUpdater: updater }));
const device = vi.hoisted(() => ({
  get: vi.fn(async () => ({ trayIcon: true, autoUpdate: true, launchAtLogin: false })),
  save: vi.fn(async (patch: object) => ({ trayIcon: true, autoUpdate: true, launchAtLogin: false, ...patch })),
}));
vi.mock('./deviceSettingsApi', () => ({ getDeviceSettings: device.get, saveDeviceSettings: device.save }));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getAccount: vi.fn(async () => ({ timezone: 'Europe/Moscow' })),
  updateAccountProfile: vi.fn(async () => ({})),
}));

const session = { username: 'f.test', role: 'candidate', isTest: true, candidateId: 'c', features: { cabinetB640: true }, emailVerified: true } as AuthUser;
let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function render() {
  const value = { session, path: '/app/account/app', search: '', match: null, consultantRoute: null, navigate: vi.fn(), signOut: async () => undefined, theme: 'light' as const, setTheme: () => undefined };
  view = mount(<ShellProvider value={value}><AppScreen node={nodeByCode('n06')!} /></ShellProvider>);
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  return view;
}

function switchFor(container: HTMLElement, title: string): HTMLInputElement {
  const label = [...container.querySelectorAll('.set-t')].find((item) => item.textContent === title);
  const input = label ? container.querySelector<HTMLInputElement>(`input[role="switch"][aria-labelledby="${label.id}"]`) : null;
  if (!input) throw new Error(`no switch «${title}»`);
  return input;
}

describe('n06 «Приложение» в .app', () => {
  it('B722: switches show this computer settings', async () => {
    const { container } = await render();
    expect(switchFor(container, 'Обновлять автоматически').checked).toBe(true);
    expect(switchFor(container, 'Запуск при входе в систему').checked).toBe(false);
    const tray = [...container.querySelectorAll('.set-t')].map((item) => item.textContent).find((text) => text?.startsWith('Значок'));
    expect(['Значок в строке меню', 'Значок в области уведомлений']).toContain(tray);
    expect(container.textContent).toContain('Работа приложения');
  });

  it('B722/B774: «Интерфейс» in mockup order; the only language is text, not a one-option list', async () => {
    const { container } = await render();
    const titles = [...container.querySelectorAll('.set-group')][0]?.querySelectorAll('.set-t') ?? [];
    expect([...titles].map((item) => item.textContent)).toEqual(['Тема', 'Язык', 'Часовой пояс', 'Валюта зарплат']);
    const language = [...titles].find((item) => item.textContent === 'Язык')?.closest('.set-row');
    expect(language?.querySelector('select')).toBeNull();
    expect(language?.querySelector('.set-r')?.textContent).toBe('Русский');
  });

  it('B593: time zones read as in the mockup — «Москва, UTC+3»', async () => {
    const { container } = await render();
    const zone = [...container.querySelectorAll('.set-t')].find((item) => item.textContent === 'Часовой пояс')?.closest('.set-row');
    const options = [...(zone?.querySelectorAll('option') ?? [])].map((item) => item.textContent);
    expect(options).toContain('Москва, UTC+3');
    expect(options.every((text) => !text?.includes('('))).toBe(true);
  });

  it('B722: automatic updates switch saves on this computer and tells the updater at once', async () => {
    const { container } = await render();
    await act(async () => switchFor(container, 'Обновлять автоматически').click());
    expect(device.save).toHaveBeenCalledWith({ autoUpdate: false });
    expect(updater.setAutoInstall).toHaveBeenLastCalledWith(false);
    expect(switchFor(container, 'Обновлять автоматически').checked).toBe(false);
  });

  it('B722: a failed save returns the switch and says so in place', async () => {
    device.save.mockRejectedValueOnce(new Error('autostart'));
    const { container } = await render();
    await act(async () => switchFor(container, 'Запуск при входе в систему').click());
    expect(switchFor(container, 'Запуск при входе в систему').checked).toBe(false);
    expect(container.textContent).toContain('Не сохранилось');
  });

  it('строка версии показывает версию, номер сборки и дату сборки', async () => {
    const value = { session, path: '/app/account/app', search: '', match: null, consultantRoute: null, navigate: vi.fn(), signOut: async () => undefined, theme: 'light' as const, setTheme: () => undefined };
    view = mount(<ShellProvider value={value}><AppScreen node={nodeByCode('n06')!} /></ShellProvider>);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    const line = [...view.container.querySelectorAll('.set-t')].map((item) => item.textContent ?? '').find((text) => text.startsWith('Версия'));
    expect(line).toMatch(new RegExp(`^Версия ${__APP_VERSION__.replace(/\./gu, '\\.')}( · сборка [0-9a-f]{7})? · \\d{1,2} [а-я]+ \\d{4}$`, 'u'));
    expect(view.container.textContent).toContain('Проверить обновления');
  });
});
