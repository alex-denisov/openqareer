import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

// B722: n06 «Приложение» в .app — «Обновления» и «Работа приложения» по макету.
// Приложение подменено мостом __TAURI_INTERNALS__: запросы к API идут через
// desktop_native_fetch в обычный fetch (его ловит mockSignedInCabinet), а команды
// настроек этого компьютера и автозапуска пишутся в журнал вызовов.

interface DesktopLog {
  readonly calls: string[];
}

async function openDesktopApp(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.addInitScript(() => {
    localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
    (window as unknown as { isTauri: boolean }).isTauri = true;
    const state = { trayIcon: true, autoUpdate: true, launchAtLogin: false };
    const log: DesktopLog = { calls: [] };
    (window as unknown as { __b722: DesktopLog }).__b722 = log;
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === 'desktop_native_fetch') {
          const request = args.request as {
            url: string;
            method: string;
            headers?: Record<string, string>;
            body?: string;
          };
          const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            ...(request.body ? { body: request.body } : {}),
          });
          return {
            status: response.status,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text(),
          };
        }
        log.calls.push(command);
        if (command === 'get_device_settings')
          return { trayIcon: state.trayIcon, autoUpdate: state.autoUpdate };
        if (command === 'save_device_settings') {
          Object.assign(state, (args.patch ?? {}) as object);
          return { trayIcon: state.trayIcon, autoUpdate: state.autoUpdate };
        }
        if (command === 'plugin:autostart|is_enabled') return state.launchAtLogin;
        if (command === 'plugin:autostart|enable') state.launchAtLogin = true;
        if (command === 'plugin:autostart|disable') state.launchAtLogin = false;
        return null;
      },
      transformCallback: () => 0,
    };
  });
  await page.goto('/app/account/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="n06"]')).toBeVisible({ timeout: 15_000 });
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __b722: DesktopLog }).__b722.calls);

test('B722: n06 в приложении — версия, проверка обновлений и переключатели этого компьютера', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'в макете группы приложения только на десктопе');
  await openDesktopApp(page);
  const screen = page.locator('[data-b640-node="n06"]');
  await expect(screen.locator('.set-h')).toHaveText([
    'Интерфейс',
    'Обновления',
    'Работа приложения',
  ]);
  await expect(screen.locator('.set-row .set-t').nth(4)).toHaveText(/^Версия \d+\.\d+\.\d+/u);
  const auto = screen.getByRole('switch', { name: 'Обновлять автоматически' });
  const launch = screen.getByRole('switch', { name: 'Запуск при входе в систему' });
  await expect(auto).toBeChecked();
  await expect(screen.getByRole('switch', { name: /^Значок в / })).toBeChecked();
  await expect(launch).not.toBeChecked();
  await expectGates(page);

  await screen.getByRole('button', { name: 'Проверить обновления' }).click();
  await expect(screen).toContainText('У вас последняя версия');
  await launch.click();
  await expect(launch).toBeChecked();
  await auto.click();
  await expect(auto).not.toBeChecked();
  const log = await calls(page);
  expect(log).toContain('plugin:updater|check');
  expect(log).toContain('plugin:autostart|enable');
  expect(log).toContain('save_device_settings');
});
