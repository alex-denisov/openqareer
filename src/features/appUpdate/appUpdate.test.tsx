// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AppUpdateBanner } from './AppUpdateBanner';
import { AppUpdateContainer } from './AppUpdateContainer';
import { AppUpdateModals } from './AppUpdateModals';
import { DEFAULT_UPDATE_INFO } from './appUpdateModel';
import type { AppUpdateActions, AppUpdateStatusData } from './appUpdateTypes';

function createMockActions(): AppUpdateActions {
  return {
    onInstall: vi.fn(),
    onEnableAutoUpdate: vi.fn(),
    onWhatsNew: vi.fn(),
    onPostpone: vi.fn(),
    onRestart: vi.fn(),
    onNextLaunch: vi.fn(),
    onCancelDownload: vi.fn(),
    onRetryNow: vi.fn(),
    onForceRestart: vi.fn(),
    onCloseModal: vi.fn(),
    onDismissBanner: vi.fn(),
  };
}

describe('B469: Desktop App Update Mechanics', () => {
  it('renders available banner and handles Установить, Включить автообновление, Что нового, Позже', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AppUpdateBanner
          state="available"
          info={{ ...DEFAULT_UPDATE_INFO, autoUpdateEnabled: false }}
          actions={actions}
        />,
      );
    });

    const installBtn = container.querySelector('[data-testid="app-update-install-btn"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    act(() => installBtn.click());
    expect(actions.onInstall).toHaveBeenCalled();

    const enableAutoBtn = container.querySelector('[data-testid="app-update-enable-auto-btn"]') as HTMLButtonElement;
    expect(enableAutoBtn).not.toBeNull();
    act(() => enableAutoBtn.click());
    expect(actions.onEnableAutoUpdate).toHaveBeenCalled();

    const whatsNewBtn = container.querySelector('[data-testid="app-update-whats-new-btn"]') as HTMLButtonElement;
    expect(whatsNewBtn).not.toBeNull();
    act(() => whatsNewBtn.click());
    expect(actions.onWhatsNew).toHaveBeenCalled();

    const laterBtn = container.querySelector('[data-testid="app-update-later-btn"]') as HTMLButtonElement;
    expect(laterBtn).not.toBeNull();
    act(() => laterBtn.click());
    expect(actions.onPostpone).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('renders ready banner and handles Перезапустить, При следующем запуске', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AppUpdateBanner state="ready" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });

    const restartBtn = container.querySelector('[data-testid="app-update-restart-btn"]') as HTMLButtonElement;
    expect(restartBtn).not.toBeNull();
    act(() => restartBtn.click());
    expect(actions.onRestart).toHaveBeenCalled();

    const nextLaunchBtn = container.querySelector('[data-testid="app-update-next-launch-btn"]') as HTMLButtonElement;
    expect(nextLaunchBtn).not.toBeNull();
    act(() => nextLaunchBtn.click());
    expect(actions.onNextLaunch).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('renders downloading modal and handles Отменить загрузку', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AppUpdateModals modal="downloading" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });

    expect(container.textContent).toContain('Загружаем версию 1.0.1');
    expect(container.textContent).toContain('64 %');

    const cancelBtn = container.querySelector('[data-testid="app-update-cancel-download-btn"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    act(() => cancelBtn.click());
    expect(actions.onCancelDownload).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('renders error modal and handles Повторить сейчас', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AppUpdateModals modal="error" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });

    expect(container.textContent).toContain('Не удалось загрузить обновление');
    const retryBtn = container.querySelector('[data-testid="app-update-retry-btn"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    act(() => retryBtn.click());
    expect(actions.onRetryNow).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('renders required modal and handles Обновить и перезапустить', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AppUpdateModals modal="required" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });

    expect(container.textContent).toContain('Нужно обновить приложение');
    const forceBtn = container.querySelector('[data-testid="app-update-force-restart-btn"]') as HTMLButtonElement;
    expect(forceBtn).not.toBeNull();
    act(() => forceBtn.click());
    expect(actions.onForceRestart).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('renders informative banner states: offline, busy_sending, up_to_date (idle)', () => {
    const actions = createMockActions();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    // 1. Offline
    act(() => {
      root.render(<AppUpdateBanner state="offline" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });
    expect(container.textContent).toContain('Не удалось проверить обновления: нет связи');

    // 2. Busy sending
    act(() => {
      root.render(<AppUpdateBanner state="busy_sending" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });
    expect(container.textContent).toContain('Перезапуск отложен: сейчас отправляется отклик на hh.ru');

    // 3. Up to date (idle)
    act(() => {
      root.render(<AppUpdateBanner state="idle" info={DEFAULT_UPDATE_INFO} actions={actions} />);
    });
    expect(container.textContent).toContain('Установлена последняя версия 1.0.1');

    act(() => root.unmount());
    container.remove();
  });

  it('AppUpdateContainer integrates banner and modal seamlessly', () => {
    const actions = createMockActions();
    const status: AppUpdateStatusData = {
      state: 'available',
      modal: 'whats_new',
      info: DEFAULT_UPDATE_INFO,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AppUpdateContainer status={status} actions={actions} />);
    });

    expect(container.textContent).toContain('Доступна версия 1.0.1');
    expect(container.textContent).toContain('Что нового в 1.0.1');

    act(() => root.unmount());
    container.remove();
  });
});
