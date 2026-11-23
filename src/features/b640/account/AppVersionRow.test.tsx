// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateStatusData } from '../../appUpdate/appUpdateTypes';
import { click, mount, type Mounted } from '../kit/testDom';
import { AppVersionRow } from './AppVersionRow';

const bridge = vi.hoisted(() => ({
  installedAppVersion: vi.fn(async (): Promise<string | null> => '1.1.195'),
}));
vi.mock('../../appUpdate/appUpdateBridge', () => bridge);

const updater = vi.hoisted(() => {
  const info = {
    version: '',
    currentVersion: '',
    releaseDate: '',
    downloadSizeMb: 0,
    autoUpdateEnabled: false,
    changelog: [],
  };
  const state = { status: { state: 'idle', modal: 'none', info } as AppUpdateStatusData };
  const listeners = new Set<() => void>();
  return {
    state,
    set(next: Partial<AppUpdateStatusData>) {
      state.status = { ...state.status, ...next, info: { ...state.status.info, ...next.info } };
      listeners.forEach((listener) => listener());
    },
    desktopUpdater: {
      getStatus: () => state.status,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      check: vi.fn(async () => 'latest' as const),
      actions: { onInstall: vi.fn(), onRestart: vi.fn(), onRetryNow: vi.fn() },
    },
  };
});
vi.mock('../../appUpdate/useDesktopUpdater', () => ({ desktopUpdater: updater.desktopUpdater }));

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  updater.set({ state: 'idle', errorMessage: undefined });
  vi.clearAllMocks();
});

async function render() {
  view = mount(
    <ul>
      <AppVersionRow />
    </ul>,
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  return view.container;
}

const button = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent === name) ?? null;

describe('B771: n06 «Обновления» в .app говорит правду', () => {
  it('версия — та, что запускает приложение, а не из package.json', async () => {
    const root = await render();
    expect(root.querySelector('.set-t')?.textContent).toMatch(/^Версия 1\.1\.195/u);
  });

  it('сбой проверки — ошибка с «Повторить», а не «последняя версия»', async () => {
    updater.desktopUpdater.check.mockResolvedValueOnce('failed' as never);
    const root = await render();
    await act(async () => button(root, 'Проверить обновления')?.click());
    expect(root.textContent).toContain('Не удалось проверить обновления');
    expect(root.textContent).not.toContain('последняя версия');
    expect(button(root, 'Повторить')).not.toBeNull();
  });

  it('проверка без новой версии — «У вас последняя версия»', async () => {
    const root = await render();
    await act(async () => button(root, 'Проверить обновления')?.click());
    expect(root.textContent).toContain('У вас последняя версия');
  });

  it('найденная в фоне версия видна сразу и ставится по «Обновить»', async () => {
    const root = await render();
    act(() => updater.set({ state: 'available', info: { version: '1.1.196' } as never }));
    expect(root.textContent).toContain('Есть версия 1.1.196');
    expect(button(root, 'Проверить обновления')).toBeNull();
    click(button(root, 'Обновить'));
    expect(updater.desktopUpdater.actions.onInstall).toHaveBeenCalled();
  });

  it('загрузка, готовность к перезапуску и сбой установки — на месте строки', async () => {
    const root = await render();
    act(() =>
      updater.set({
        state: 'downloading',
        info: { version: '1.1.196', progressPercent: 40 } as never,
      }),
    );
    expect(root.textContent).toContain('Загружаем версию 1.1.196 · 40 %');
    act(() => updater.set({ state: 'ready' }));
    expect(root.textContent).toContain('Версия 1.1.196 установится при перезапуске');
    click(button(root, 'Перезапустить'));
    expect(updater.desktopUpdater.actions.onRestart).toHaveBeenCalled();
    act(() => updater.set({ state: 'error', errorMessage: 'Загрузка прервалась.' }));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Загрузка прервалась.');
    click(button(root, 'Повторить'));
    expect(updater.desktopUpdater.actions.onRetryNow).toHaveBeenCalled();
  });
});
