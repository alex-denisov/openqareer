import {
  desktopNativeFetch,
  invokeDesktopCommand,
  isTauriEnvironment,
} from '../../services/desktop/desktopBridge';
import type { ConnectionPlatform } from './connectionResult';

/** Where the connector flow currently stands, for both platforms. */
export type ConnectorSessionStep = 'idle' | 'opening' | 'session_open' | 'checking';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const PLATFORM_NAMES: Record<ConnectionPlatform, string> = {
  linkedin: 'LinkedIn',
  hh: 'hh.ru',
};

export interface SessionOpenResult {
  readonly opened: boolean;
  readonly reason?: string;
}

export interface SessionLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DesktopSessionWindowReport {
  readonly opened: boolean;
  readonly label: string;
  readonly reason?: string | null;
}

interface DesktopSessionPageReport {
  readonly ok: boolean;
  readonly url: string;
  readonly body: string;
}

interface DesktopSessionInspectionReport {
  readonly ready: boolean;
  readonly url: string;
  readonly signedInApplicant: boolean;
  readonly login: boolean;
  readonly otp: boolean;
  readonly captcha: boolean;
}

/**
 * Opens the platform's own sign-in window. The candidate authenticates on the
 * platform, in their own session — credentials never pass through OpenQareer,
 * which is the whole reason the desktop companion exists.
 *
 * Inside the desktop shell this has to go through Rust: `window.open` is a
 * silent no-op in the Tauri webview, so the old flow announced a sign-in window
 * that never existed (B149).
 */
export async function openConnectorSession(
  platform: ConnectionPlatform,
  url: string,
  layout?: SessionLayout,
): Promise<SessionOpenResult> {
  if (typeof window === 'undefined') {
    return { opened: false, reason: 'no_window_environment' };
  }

  if (isTauriEnvironment()) {
    try {
      const report = await invokeDesktopCommand<DesktopSessionWindowReport>(
        'open_connector_session',
        { request: { platform, url, layout } },
      );
      if (!report) return { opened: false, reason: 'desktop_bridge_unavailable' };
      return report.opened
        ? { opened: true }
        : { opened: false, reason: report.reason ?? 'window_build_failed' };
    } catch {
      return { opened: false, reason: 'desktop_bridge_unavailable' };
    }
  }

  const popup = window.open(
    url,
    `OpenQareer_${platform}_Session`,
    'width=960,height=820,menubar=no,toolbar=no,location=yes,status=no',
  );
  return popup ? { opened: true } : { opened: false, reason: 'window_blocked' };
}

export async function closeConnectorSession(platform: ConnectionPlatform): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeDesktopCommand<boolean>('close_connector_session', { platform });
}

export async function resetConnectorSession(platform: ConnectionPlatform): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  return (
    (await invokeDesktopCommand<boolean>('reset_connector_session', { platform })) === true
  );
}

export async function resizeConnectorSession(
  platform: ConnectionPlatform,
  layout: SessionLayout,
): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeDesktopCommand<boolean>('resize_connector_session', { platform, layout });
}

/** Explains, honestly, why no sign-in window is on screen. */
export function sessionOpenFailureMessage(platform: ConnectionPlatform, reason?: string): string {
  const name = PLATFORM_NAMES[platform] ?? platform;
  switch (reason) {
    case 'window_blocked':
      return `Браузер заблокировал окно входа ${name}. Разрешите всплывающие окна для этого сайта или используйте десктопное приложение OpenQareer.`;
    case 'desktop_bridge_unavailable':
      return `Десктопное приложение не смогло открыть окно входа ${name}. Перезапустите приложение и повторите попытку.`;
    case 'unsupported_platform':
    case 'url_not_allowed':
      return `Адрес входа ${name} не прошёл проверку безопасности. Обновите приложение до свежей версии.`;
    case 'no_window_environment':
      return `Окно входа ${name} можно открыть только в приложении или браузере.`;
    case 'window_not_registered':
      return `Окно входа ${name} создалось, но приложение не получило к нему доступ. Перезапустите OpenQareer и повторите попытку или загрузите PDF-резюме.`;
    default:
      return `Открыть окно входа ${name} не удалось. Повторите попытку или загрузите PDF-резюме.`;
  }
}

/** Only the two states a session check can leave the candidate in. */
export interface SessionCheckFailure {
  readonly message: string;
  readonly step: ConnectorSessionStep;
}

function reasonCode(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  return raw.split(':')[0].trim();
}

/**
 * Turns an internal failure into something the candidate can act on. Raw codes
 * ("navigate_failed: EPIPE") are diagnostics, not an explanation.
 */
export function sessionCheckFailure(
  platform: ConnectionPlatform,
  reason: unknown,
): SessionCheckFailure {
  const name = PLATFORM_NAMES[platform] ?? platform;
  switch (reasonCode(reason)) {
    case 'session_window_missing':
      return {
        message: `Окно входа ${name} закрыто. Откройте его снова и завершите вход.`,
        step: 'idle',
      };
    case 'page_load_timeout':
    case 'navigate_failed':
    case 'eval_timeout':
    case 'eval_failed':
      return {
        message: `Страница ${name} не загрузилась в окне сессии. Проверьте соединение и повторите попытку или загрузите PDF-резюме.`,
        step: 'session_open',
      };
    default:
      return {
        message: `Проверить сессию ${name} не удалось. Повторите попытку или загрузите PDF-резюме.`,
        step: 'session_open',
      };
  }
}

type RouteTone = 'pending' | 'ok' | 'blocked';

export interface RouteNotice {
  readonly tone: RouteTone;
  readonly text: string;
}

export interface RouteCapability {
  /**
   * Whether this build can route the platform around a closed direct path.
   * Only LinkedIn has such a route; hh.ru is deliberately kept direct.
   */
  readonly protectedRouteAvailable?: boolean;
  /** Whether that route is up **now**, proven by its own live probe. */
  readonly protectedRouteActive?: boolean;
}

/**
 * States the measured route, and nothing else. Promising a tunnel that is not
 * running, or a "verified" route that timed out, is exactly the kind of claim
 * this flow was reported for (B149).
 *
 * A closed direct path is only a dead end where nothing can route around it.
 * Announcing "окно входа останется пустым" in a build that starts the protected
 * route on the very next click is a refusal the app immediately contradicts —
 * the owner read it as being turned away before trying (B157).
 */
export function platformRouteNotice(
  platform: ConnectionPlatform,
  probe?: { readonly accessible: boolean },
  capability: RouteCapability = {},
): RouteNotice {
  const name = PLATFORM_NAMES[platform] ?? platform;
  if (capability.protectedRouteActive) {
    return { tone: 'ok', text: `Защищённый EU-маршрут ${name} активен` };
  }
  if (!probe) {
    return { tone: 'pending', text: `Проверяем доступность ${name}…` };
  }
  if (probe.accessible) {
    return { tone: 'ok', text: `Прямой маршрут до ${name} сейчас работает` };
  }
  if (capability.protectedRouteAvailable) {
    return {
      tone: 'pending',
      text: `Прямой маршрут до ${name} закрыт. Окно входа откроется через защищённый EU-маршрут.`,
    };
  }
  return {
    tone: 'blocked',
    text: `${name} недоступен с текущего сетевого маршрута — окно входа останется пустым. Загрузите PDF-резюме или смените сеть.`,
  };
}

export interface SessionPageResult {
  readonly ok: boolean;
  readonly body?: string;
  readonly url?: string;
}

export interface SessionInspectionResult {
  readonly ready: boolean;
  readonly url: string;
  readonly signedInApplicant: boolean;
  readonly login: boolean;
  readonly otp: boolean;
  readonly captcha: boolean;
}

/**
 * Inspects the page the candidate is currently using without changing its URL.
 * Login, MFA and CAPTCHA forms must stay entirely under the candidate's control.
 */
export async function inspectSessionPage(
  platform: ConnectionPlatform,
): Promise<SessionInspectionResult> {
  if (!isTauriEnvironment()) {
    return {
      ready: false,
      url: '',
      signedInApplicant: false,
      login: false,
      otp: false,
      captcha: false,
    };
  }
  const report = await invokeDesktopCommand<DesktopSessionInspectionReport>(
    'inspect_connector_session_page',
    { platform },
  );
  return report ?? {
    ready: false,
    url: '',
    signedInApplicant: false,
    login: false,
    otp: false,
    captcha: false,
  };
}

/**
 * Reads a page inside the candidate's own session window. A separate HTTP
 * client cannot do this — it holds none of the cookies the candidate just
 * created by signing in — so the desktop shell reads the live document.
 */
export async function readSessionPage(
  platform: ConnectionPlatform,
  url: string,
): Promise<SessionPageResult> {
  if (isTauriEnvironment()) {
    const report = await invokeDesktopCommand<DesktopSessionPageReport>(
      'read_connector_session_page',
      { request: { platform, url } },
    );
    if (report) {
      return { ok: report.ok, body: report.body, url: report.url };
    }
  }

  const response = await desktopNativeFetch({
    url,
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  return { ok: Boolean(response?.ok), body: response?.body };
}

export function looksLikeLinkedInLoginPage(body: string): boolean {
  return (
    body.includes('linkedin.com/checkpoint') ||
    body.includes('session_password') ||
    body.includes('join-form')
  );
}

export function looksLikeHhLoginPage(body: string): boolean {
  return body.includes('account/login') || body.includes('data-qa="account-login-page"');
}

export function looksLikeHhVpnBlock(body: string): boolean {
  return body.includes('VPN мешает работе сайта') || body.includes('vpn-cheeck');
}
