/**
 * Особые состояния первого запуска (макет экрана 0, блок «Состояния»).
 * Каждое выводится из реального условия, а не из флага: сеть и таймаут входа,
 * ход чтения источника, пропуск шага «Источник», подключения на сервере.
 */

export const SESSION_EXPIRED_TEXT = 'Вход устарел. Войдите снова, один раз для всего приложения.';
export const SESSION_ERROR_TEXT = 'Не удалось войти: сервер не ответил. Данные не потеряны.';
export const SESSION_STALE_LABEL = 'Проверяем вход…';
export const EMPTY_SOURCES_TEXT =
  'Источник не выбран. Можно рассказать консультанту, профиль соберётся из ответов.';
/** Через столько ожидание считается долгим и подпись называет субъект и шаг. */
export const FIRST_RUN_STALE_DELAY_MS = 4_000;

export type SessionGateState = 'skeleton' | 'stale-loading' | 'error';

export function sessionGateState(input: {
  readonly error?: string;
  readonly waitIsLong: boolean;
}): SessionGateState {
  if (input.error) return 'error';
  return input.waitIsLong ? 'stale-loading' : 'skeleton';
}

export interface ConnectorPresence {
  readonly linkedin: boolean;
  readonly hh: boolean;
}

/** Ровно один из двух коннекторов подключён — иначе заметки нет. */
export function partialSourcesMessage(presence: ConnectorPresence | null): string | null {
  if (!presence || presence.linkedin === presence.hh) return null;
  return presence.linkedin
    ? 'LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.'
    : 'hh.ru подключён, LinkedIn нет: доступно после подключения LinkedIn.';
}

export function connectorPresence(
  connections: readonly { readonly platform: string; readonly status?: string }[],
): ConnectorPresence {
  const connected = (platform: string) =>
    connections.some((item) => item.platform === platform && item.status === 'connected');
  return { linkedin: connected('linkedin'), hh: connected('hh') };
}

export function linkedinStaleLabel(
  progress: { readonly readCount: number; readonly total: number } | null,
): string | null {
  if (!progress || progress.total === 0) return null;
  const section = Math.min(progress.readCount + 1, progress.total);
  return `Читаем LinkedIn: раздел ${section} из ${progress.total}`;
}

export function fileStaleLabel(fileName?: string): string {
  return fileName ? `Читаем файл: ${fileName}` : 'Читаем файл';
}
