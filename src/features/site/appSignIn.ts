/**
 * B755: вход в приложение через браузер. Приложение открывает в браузере
 * `/app-sign-in?challenge=…&state=…[&client=dev]`; страница по нажатию «Войти» получает код и
 * возвращает его только по постоянному адресу приложения — адрес возврата из запроса не берётся,
 * выбирается лишь одна из двух схем: сборки для openqareer.com и отладочной.
 */
export const APP_SIGN_IN_PATH = '/app-sign-in';

const CALLBACKS = {
  app: 'openqareer://signed-in',
  dev: 'openqareer-dev://signed-in',
} as const;

export type AppClient = keyof typeof CALLBACKS;

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const STATE = /^[A-Za-z0-9_-]{16,64}$/u;

export interface AppSignInRequest {
  readonly challenge: string;
  readonly state: string;
  readonly client: AppClient;
}

export function readAppSignInRequest(search: string): AppSignInRequest | null {
  const params = new URLSearchParams(search);
  const challenge = params.get('challenge') ?? '';
  const state = params.get('state') ?? '';
  const clientParam = params.get('client');
  if (clientParam !== null && clientParam !== 'dev') return null;
  const client: AppClient = clientParam === 'dev' ? 'dev' : 'app';
  return CHALLENGE.test(challenge) && STATE.test(state) ? { challenge, state, client } : null;
}

function requestParams(request: AppSignInRequest): Record<string, string> {
  return {
    challenge: request.challenge,
    state: request.state,
    ...(request.client === 'dev' ? { client: 'dev' } : {}),
  };
}

/** Куда вернуться после входа на сайте: на ту же страницу с теми же параметрами. */
export function appSignInPath(request: AppSignInRequest): string {
  return `${APP_SIGN_IN_PATH}?${new URLSearchParams(requestParams(request)).toString()}`;
}

/** Вход на сайте из приложения: `/login?from=app-sign-in&…` возвращает обратно сюда. */
export function appSignInLoginPath(request: AppSignInRequest): string {
  const params = new URLSearchParams({ from: 'app-sign-in', ...requestParams(request) });
  return `/login?${params.toString()}`;
}

/** Путь возврата после входа, если вход начат из приложения; иначе `null`. */
export function appSignInReturnPath(search: string): string | null {
  if (new URLSearchParams(search).get('from') !== 'app-sign-in') return null;
  const request = readAppSignInRequest(search);
  return request ? appSignInPath(request) : null;
}

export function appCallbackUrl(
  request: AppSignInRequest,
  result: { readonly code: string } | 'cancel',
): string {
  const params = new URLSearchParams(
    result === 'cancel'
      ? { error: 'cancel', state: request.state }
      : { code: result.code, state: request.state },
  );
  return `${CALLBACKS[request.client]}?${params.toString()}`;
}

/** Код просит сессия сайта в cookie: обычный клиент API добавил бы Bearer, и сервер отказал бы. */
export async function requestAppCode(challenge: string): Promise<string> {
  const response = await fetch('/api/v1/auth/app-code', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ challenge }),
  });
  if (!response.ok) throw new Error(`app code refused: ${response.status}`);
  const payload = (await response.json()) as { data?: { code?: unknown } };
  const code = payload.data?.code;
  if (typeof code !== 'string') throw new Error('app code missing');
  return code;
}
