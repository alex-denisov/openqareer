// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { AdminLinkedinRemoteLoginPanel } from './AdminLinkedinRemoteLoginPanel';
import * as api from './linkedinRemoteLoginApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = (over: Partial<api.RemoteLoginFrame> = {}): api.RemoteLoginFrame => ({
  state: 'login',
  url: 'https://www.linkedin.com/login',
  imageBase64: 'AAAA',
  width: 1440,
  height: 900,
  capturedAt: '2026-10-05T10:00:00.000Z',
  reason: null,
  ...over,
});

describe('AdminLinkedinRemoteLoginPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onClose.mockReset();
    vi.spyOn(api, 'fetchRemoteLoginFrame').mockResolvedValue(frame());
    vi.spyOn(api, 'sendRemoteLoginInput').mockResolvedValue(undefined);
    vi.spyOn(api, 'closeRemoteLogin').mockResolvedValue(undefined);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () =>
      root.render(
        <AdminLinkedinRemoteLoginPanel
          accountId="acc-1"
          accountLabel="Основной пул"
          loginId="login-1"
          onClose={onClose}
        />,
      ),
    );
  }
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('labels the dialog and shows the login state, then follows the status', async () => {
    await render();
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(host.textContent).toContain('Страница входа LinkedIn');
    vi.mocked(api.fetchRemoteLoginFrame).mockResolvedValue(frame({ state: 'checkpoint' }));
    await advance(400);
    expect(host.textContent).toContain('пройдите её здесь');
    vi.mocked(api.fetchRemoteLoginFrame).mockResolvedValue(frame({ state: 'signed_in' }));
    await advance(400);
    expect(host.textContent).toContain('Вход выполнен, сессия сохранена на сервере');
  });

  it('stops polling once closed and says why', async () => {
    vi.mocked(api.fetchRemoteLoginFrame).mockResolvedValue(
      frame({ state: 'closed', reason: 'idle' }),
    );
    await render();
    expect(host.textContent).toContain('Закрыто после 10 минут простоя');
    const calls = vi.mocked(api.fetchRemoteLoginFrame).mock.calls.length;
    await advance(2000);
    expect(vi.mocked(api.fetchRemoteLoginFrame).mock.calls.length).toBe(calls);
    expect(host.querySelector('input[type="text"]')).toBeNull();
  });

  it('polls about three times a second', async () => {
    await render();
    await advance(1000);
    const calls = vi.mocked(api.fetchRemoteLoginFrame).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it('turns a click on the scaled image into page coordinates', async () => {
    await render();
    const img = host.querySelector('img')!;
    img.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 720,
        height: 450,
        right: 730,
        bottom: 470,
        x: 10,
        y: 20,
      }) as DOMRect;
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 370, clientY: 245 }));
    });
    expect(api.sendRemoteLoginInput).toHaveBeenCalledWith('acc-1', 'login-1', {
      type: 'click',
      x: 720,
      y: 450,
    });
  });

  it('sends text, clears the field and keeps no copy of it', async () => {
    await render();
    const input = host.querySelector('input')!;
    expect(input.type).toBe('text');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'секрет',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Отправить').click());
    expect(api.sendRemoteLoginInput).toHaveBeenCalledWith('acc-1', 'login-1', {
      type: 'text',
      text: 'секрет',
    });
    expect(input.value).toBe('');
    expect(host.textContent).not.toContain('секрет');
  });

  it('sends Enter, Tab and Backspace keys', async () => {
    await render();
    for (const key of ['Enter', 'Tab', 'Backspace']) {
      await act(async () => button(key).click());
      expect(api.sendRemoteLoginInput).toHaveBeenCalledWith('acc-1', 'login-1', {
        type: 'key',
        key,
      });
    }
  });

  it('shows an input error as text and never as success', async () => {
    vi.mocked(api.sendRemoteLoginInput).mockRejectedValue(
      new CoachApiError('x', 'remote_login_closed', false),
    );
    await render();
    await act(async () => button('Enter').click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('уже закрыто');
    expect(host.textContent).not.toContain('Отправлено');
  });

  it('shows a frame error and ends the panel when the server forgot the login', async () => {
    vi.mocked(api.fetchRemoteLoginFrame).mockRejectedValue(
      new CoachApiError('x', 'remote_login_not_found', false),
    );
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('не найдено');
    const calls = vi.mocked(api.fetchRemoteLoginFrame).mock.calls.length;
    await advance(1500);
    expect(vi.mocked(api.fetchRemoteLoginFrame).mock.calls.length).toBe(calls);
  });

  it('Escape sends DELETE and closes', async () => {
    await render();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(api.closeRemoteLogin).toHaveBeenCalledWith('acc-1', 'login-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a failed DELETE to the owner of the panel', async () => {
    vi.mocked(api.closeRemoteLogin).mockRejectedValue(new Error('offline'));
    await render();
    await act(async () => button('Закрыть').click());
    expect(onClose).toHaveBeenCalledWith(expect.stringContaining('Не удалось связаться'));
  });
});
