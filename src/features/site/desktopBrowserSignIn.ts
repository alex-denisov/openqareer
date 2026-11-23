import { listen } from '@tauri-apps/api/event';
import { apiFetch, getApiBaseUrl, getClientDeviceId, readDataObject } from '../coach/apiClient';
import type { AuthUser } from '../coach/coachApi';
import { invokeDesktopCommand, isTauriEnvironment } from '../../services/desktop/desktopBridge';

/**
 * B755: вход в приложение через браузер. Verifier создаётся здесь и наружу не уходит: браузер
 * получает только его хеш (challenge) и state, а код из адреса возврата без verifier бесполезен.
 */

/** Событие, которым приложение передаёт окну адрес `openqareer://signed-in?…`. */
export const SIGN_IN_EVENT = 'openqareer://sign-in-callback';
const CALLBACK_PREFIXES = ['openqareer://signed-in?', 'openqareer-dev://signed-in?'];

function base64Url(bytes: Uint8Array): string {
  const text = String.fromCharCode(...bytes);
  return btoa(text).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function randomToken(length: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Кнопка есть только в приложении на Mac. */
export function canSignInThroughBrowser(): boolean {
  return isTauriEnvironment() && /Macintosh|Mac OS X/u.test(navigator.userAgent);
}

export type CallbackResult =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'foreign' };

/** Адрес возврата: код, отмена или чужой (другой state — от прежней попытки, его пропускаем). */
export function readCallback(callback: string, state: string): CallbackResult {
  const prefix = CALLBACK_PREFIXES.find((item) => callback.startsWith(item));
  if (!prefix) return { kind: 'foreign' };
  const params = new URLSearchParams(callback.slice(prefix.length));
  if (params.get('state') !== state) return { kind: 'foreign' };
  if (params.get('error') === 'cancel') return { kind: 'cancel' };
  const code = params.get('code');
  return code ? { kind: 'code', code } : { kind: 'foreign' };
}

async function exchange(code: string, verifier: string): Promise<AuthUser> {
  const deviceId = getClientDeviceId();
  const response = await apiFetch('/api/v1/auth/app-code/exchange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId ? { 'X-OpenQareer-Device-Id': deviceId } : {}),
    },
    body: JSON.stringify({ code, verifier }),
  });
  return readDataObject<AuthUser>(response);
}

/** Попытка без ответа из браузера закрывается сама: verifier не живёт в памяти дольше. */
const ATTEMPT_MS = 10 * 60_000;

let attempt = 0;

/**
 * Открывает вход в браузере и ждёт адрес возврата. Повторное нажатие начинает новую попытку:
 * прежняя закрывается с `null`. Отмена в браузере — тоже `null`.
 */
export async function signInThroughBrowser(): Promise<AuthUser | null> {
  const current = ++attempt;
  const verifier = randomToken(32);
  const state = randomToken(16);
  let finish: (result: CallbackResult | null) => void = () => undefined;
  const answered = new Promise<CallbackResult | null>((resolve) => {
    finish = resolve;
  });
  const superseded = window.setInterval(() => {
    if (attempt !== current) finish(null);
  }, 500);
  const expire = window.setTimeout(() => finish(null), ATTEMPT_MS);
  const unlisten = await listen<string>(SIGN_IN_EVENT, (event) => {
    const result = readCallback(event.payload, state);
    if (result.kind !== 'foreign') finish(result);
  });
  try {
    const site = getApiBaseUrl() || window.location.origin;
    await invokeDesktopCommand('desktop_open_sign_in', {
      site,
      challenge: await challengeOf(verifier),
      state,
    });
    const result = await answered;
    return result?.kind === 'code' ? await exchange(result.code, verifier) : null;
  } finally {
    window.clearInterval(superseded);
    window.clearTimeout(expire);
    unlisten();
  }
}
