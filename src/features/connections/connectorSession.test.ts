import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeConnectorSession,
  looksLikeHhLoginPage,
  looksLikeHhVpnBlock,
  looksLikeLinkedInLoginPage,
  inspectSessionPage,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  resetConnectorSession,
  resizeConnectorSession,
  sessionCheckFailure,
  sessionOpenFailureMessage,
} from './connectorSession';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
  vi.restoreAllMocks();
});

function useWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('openConnectorSession', () => {
  it('reports failure when the browser refuses to open the session window', async () => {
    useWindow({ open: () => null });

    const result = await openConnectorSession(
      'hh',
      'https://hh.ru/account/login',
    );

    expect(result.opened).toBe(false);
    expect(result.reason).toBe('window_blocked');
  });

  it('reports success when the browser opens the session window', async () => {
    useWindow({ open: () => ({ closed: false }) });

    const result = await openConnectorSession(
      'linkedin',
      'https://www.linkedin.com/login',
    );

    expect(result.opened).toBe(true);
  });

  it('reports failure when the desktop shell cannot open the native window', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async () => ({
          opened: false,
          label: 'connector-linkedin',
          reason: 'window_build_failed',
        }),
      },
      open: () => ({ closed: false }),
    });

    const result = await openConnectorSession(
      'linkedin',
      'https://www.linkedin.com/login',
    );

    expect(result.opened).toBe(false);
    expect(result.reason).toBe('window_build_failed');
  });

  it('never claims the desktop window is open when the command throws', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async () => {
          throw new Error('command not found');
        },
      },
      open: () => ({ closed: false }),
    });

    const result = await openConnectorSession('hh', 'https://hh.ru/account/login');

    expect(result.opened).toBe(false);
    expect(result.reason).toBe('desktop_bridge_unavailable');
  });
});

describe('sessionOpenFailureMessage', () => {
  it('explains a blocked window per platform without implying success', () => {
    const hh = sessionOpenFailureMessage('hh', 'window_blocked');
    const linkedin = sessionOpenFailureMessage('linkedin', 'window_blocked');

    expect(hh).toContain('hh.ru');
    expect(linkedin).toContain('LinkedIn');
    expect(hh).not.toMatch(/открыт[оа]/i);
  });

  it('explains an unreachable desktop shell', () => {
    expect(sessionOpenFailureMessage('linkedin', 'desktop_bridge_unavailable')).toMatch(
      /приложени/i,
    );
  });

  it('falls back to an honest message for an unknown reason', () => {
    expect(sessionOpenFailureMessage('hh', 'something_new')).toMatch(/не удалось/i);
  });
});

describe('sessionCheckFailure', () => {
  it('sends the candidate back to reopening when the window is gone', () => {
    const failure = sessionCheckFailure('hh', 'session_window_missing');

    expect(failure.step).toBe('idle');
    expect(failure.message).toMatch(/закрыт/i);
    expect(failure.message).toContain('hh.ru');
  });

  it('keeps the session step when the page itself did not load', () => {
    const failure = sessionCheckFailure('linkedin', 'page_load_timeout');

    expect(failure.step).toBe('session_open');
    expect(failure.message).toMatch(/не загрузилась|не открылась/i);
  });

  it('never leaks a raw internal reason to the candidate', () => {
    const failure = sessionCheckFailure('linkedin', 'navigate_failed: EPIPE');

    expect(failure.message).not.toContain('EPIPE');
    expect(failure.message).not.toContain('navigate_failed');
  });
});

describe('session window commands in the desktop shell', () => {
  function useDesktop(handler: (cmd: string, args: unknown) => unknown) {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: unknown) => {
          calls.push({ cmd, args });
          return handler(cmd, args);
        },
      },
    });
    return calls;
  }

  it('closes, resets and resizes through the desktop bridge', async () => {
    const calls = useDesktop(() => true);

    await closeConnectorSession('hh');
    await expect(resetConnectorSession('linkedin')).resolves.toBe(true);
    await resizeConnectorSession('hh', { x: 1, y: 2, width: 400, height: 400 });

    expect(calls.map((call) => call.cmd)).toEqual([
      'close_connector_session',
      'reset_connector_session',
      'resize_connector_session',
    ]);
  });

  it('treats anything but a confirmed true as a command that did not happen', async () => {
    useDesktop(() => null);

    await expect(resetConnectorSession('hh')).resolves.toBe(false);
  });

  it('reports an unreadable inspection as "nothing recognised", never as ready', async () => {
    useDesktop(() => null);

    await expect(inspectSessionPage('hh')).resolves.toEqual({
      ready: false,
      url: '',
      signedInApplicant: false,
      login: false,
      otp: false,
      captcha: false,
    });
  });
});

describe('platformRouteNotice', () => {
  it('says it is still checking while the probe is in flight', () => {
    expect(platformRouteNotice('linkedin', undefined).tone).toBe('pending');
  });

  it('confirms a route only when the platform really answered', () => {
    const notice = platformRouteNotice('linkedin', {
      accessible: true,
    });

    expect(notice.tone).toBe('ok');
    expect(notice.text).toContain('LinkedIn');
  });

  it('warns that the sign-in window will stay blank on a blocked route', () => {
    const notice = platformRouteNotice('linkedin', { accessible: false });

    expect(notice.tone).toBe('blocked');
    expect(notice.text).toMatch(/недоступен/i);
    expect(notice.text).not.toMatch(/туннель/i);
  });

  it('does not refuse a blocked direct route the app is about to route around', () => {
    const notice = platformRouteNotice(
      'linkedin',
      { accessible: false },
      { protectedRouteAvailable: true },
    );

    // Saying "окно входа останется пустым" while the protected route starts on
    // the very next click is a refusal the app then contradicts (B157).
    expect(notice.tone).not.toBe('blocked');
    expect(notice.text).not.toMatch(/останется пустым/i);
    expect(notice.text).toMatch(/защищённый/i);
  });

  it('states the protected route only once it is really carrying traffic', () => {
    const notice = platformRouteNotice(
      'linkedin',
      { accessible: false },
      { protectedRouteAvailable: true, protectedRouteActive: true },
    );

    expect(notice.tone).toBe('ok');
    expect(notice.text).toMatch(/защищённый eu-маршрут/i);
    expect(notice.text).toMatch(/активен/i);
  });

  it('keeps hh.ru honest: no protected route exists for it', () => {
    const notice = platformRouteNotice('hh', { accessible: false });

    expect(notice.tone).toBe('blocked');
    expect(notice.text).toMatch(/hh\.ru/);
    expect(notice.text).not.toMatch(/защищённый/i);
  });
});

describe('readSessionPage', () => {
  it('returns the document the desktop session window is showing', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string) => {
          expect(cmd).toBe('read_connector_session_page');
          return {
            ok: true,
            url: 'https://hh.ru/applicant/resumes',
            body: '<html>resumes</html>',
          };
        },
      },
    });

    const page = await readSessionPage('hh', 'https://hh.ru/applicant/resumes');

    expect(page.ok).toBe(true);
    expect(page.body).toContain('resumes');
    expect(page.url).toBe('https://hh.ru/applicant/resumes');
  });

  it('propagates a closed session window instead of reporting an empty page', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async () => {
          throw 'session_window_missing';
        },
      },
    });

    await expect(
      readSessionPage('hh', 'https://hh.ru/applicant/resumes'),
    ).rejects.toBeDefined();
  });

  it('reads nothing on the web, where no platform session is available', async () => {
    useWindow({});

    const page = await readSessionPage(
      'linkedin',
      'https://www.linkedin.com/in/me/',
    );

    expect(page.ok).toBe(false);
    expect(page.body).toBeUndefined();
  });
});

describe('inspectSessionPage', () => {
  it('reads the current desktop document without supplying a navigation target', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: unknown) => {
          expect(cmd).toBe('inspect_connector_session_page');
          expect(args).toEqual({ platform: 'hh' });
          return {
            ready: true,
            url: 'https://hh.ru/account/login?step=otp',
            signedInApplicant: false,
            login: true,
            otp: true,
            captcha: false,
          };
        },
      },
    });

    await expect(inspectSessionPage('hh')).resolves.toMatchObject({
      ready: true,
      url: 'https://hh.ru/account/login?step=otp',
      otp: true,
    });
    await expect(inspectSessionPage('hh')).resolves.not.toHaveProperty('body');
  });
});

describe('resetConnectorSession', () => {
  it('clears the exact provider runtime session through the desktop boundary', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: unknown) => {
          expect(cmd).toBe('reset_connector_session');
          expect(args).toEqual({ platform: 'hh' });
          return true;
        },
      },
    });

    await expect(resetConnectorSession('hh')).resolves.toBe(true);
  });
});

describe('page recognisers', () => {
  it('recognises a LinkedIn page that still asks for credentials', () => {
    expect(looksLikeLinkedInLoginPage('<input name="session_password">')).toBe(
      true,
    );
    expect(looksLikeLinkedInLoginPage('<div id="join-form">')).toBe(true);
    expect(looksLikeLinkedInLoginPage('https://linkedin.com/checkpoint/x')).toBe(
      true,
    );
    expect(looksLikeLinkedInLoginPage('<h1>Marina Orlova</h1>')).toBe(false);
  });

  it('recognises an hh.ru login page and its VPN block', () => {
    expect(looksLikeHhLoginPage('<a href="/account/login">')).toBe(true);
    expect(looksLikeHhLoginPage('<div data-qa="account-login-page">')).toBe(
      true,
    );
    expect(looksLikeHhLoginPage('<h1>Мои резюме</h1>')).toBe(false);
    expect(looksLikeHhVpnBlock('VPN мешает работе сайта')).toBe(true);
    expect(looksLikeHhVpnBlock('<div class="vpn-cheeck">')).toBe(true);
    expect(looksLikeHhVpnBlock('<h1>Мои резюме</h1>')).toBe(false);
  });
});

describe('sessionOpenFailureMessage security reasons', () => {
  it('asks for an update when the shell refused the address', () => {
    expect(sessionOpenFailureMessage('linkedin', 'url_not_allowed')).toMatch(
      /безопасност/i,
    );
    expect(sessionOpenFailureMessage('hh', 'unsupported_platform')).toMatch(
      /безопасност/i,
    );
  });

  it('explains a headless environment', () => {
    expect(
      sessionOpenFailureMessage('hh', 'no_window_environment'),
    ).toMatch(/приложении|браузере/i);
  });
});

describe('openConnectorSession outside a window', () => {
  it('cannot open anything without a window environment', async () => {
    Reflect.deleteProperty(globalThis, 'window');

    const result = await openConnectorSession('hh', 'https://hh.ru/account/login');

    expect(result).toEqual({ opened: false, reason: 'no_window_environment' });
  });
});

describe('failure mapping edge cases', () => {
  it('treats a desktop report without a reason as a failed window build', async () => {
    useWindow({
      __TAURI_INTERNALS__: {
        invoke: async () => ({
          opened: false,
          label: 'connector-hh',
          reason: null,
        }),
      },
    });

    const result = await openConnectorSession('hh', 'https://hh.ru/account/login');

    expect(result).toEqual({ opened: false, reason: 'window_build_failed' });
  });

  it('falls back to a usable message for an unmapped or missing reason', () => {
    expect(sessionCheckFailure('hh', undefined).step).toBe('session_open');
    expect(sessionCheckFailure('hh', new Error('eval_failed: boom')).step).toBe(
      'session_open',
    );
    expect(sessionCheckFailure('linkedin', {}).message).toMatch(/не удалось/i);
  });
});

describe('sessionOpenFailureMessage', () => {
  it('separates a window that never appeared from one the app cannot reach', () => {
    expect(sessionOpenFailureMessage('hh', 'window_not_registered')).toContain(
      'приложение не получило к нему доступ',
    );
    expect(sessionOpenFailureMessage('hh', 'window_blocked')).toContain(
      'Браузер заблокировал',
    );
    expect(sessionOpenFailureMessage('linkedin', 'unsupported_platform')).toContain(
      'проверку безопасности',
    );
    expect(sessionOpenFailureMessage('linkedin', 'no_window_environment')).toContain(
      'только в приложении или браузере',
    );
    expect(sessionOpenFailureMessage('hh', 'something_new')).toContain(
      'Повторите попытку',
    );
  });
});
