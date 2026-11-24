import {
  inspectSessionPage,
  isConnectorSessionOpen,
  openConnectorSession,
} from '../../../connections/connectorSession';

export const HH_LOGIN_URL = 'https://hh.ru/account/login';
/** Сколько ждём страницу окна hh.ru. */
export const HH_WINDOW_READY_MS = 20_000;
const HH_WINDOW_POLL_MS = 500;
/** Страница может сама увести вошедшего дальше или дорисоваться: невошедший — тот, кто на ней остался. */
const HH_SIGNED_OUT_SETTLE_MS = 4_000;
const HH_PAGE = /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\//u;

export type HhWindowState = 'ready' | 'signed_out';

/** Ждёт, пока окно покажет вошедшего; капчу окна вызывающий видит сам. */
async function settleHhWindow(): Promise<HhWindowState> {
  const deadline = Date.now() + HH_WINDOW_READY_MS;
  let signedOutSince: number | null = null;
  while (Date.now() < deadline) {
    // Пока страница сменяется, чтение окна обрывается: читаем снова до срока.
    const page = await inspectSessionPage('hh').catch(() => null);
    if (page?.ready && HH_PAGE.test(page.url)) {
      if (!page.login && (page.signedInApplicant || page.captcha)) return 'ready';
      signedOutSince ??= Date.now();
      if (Date.now() - signedOutSince >= HH_SIGNED_OUT_SETTLE_MS) return 'signed_out';
    } else signedOutSince = null;
    await new Promise((resolve) => setTimeout(resolve, HH_WINDOW_POLL_MS));
  }
  throw new Error('hh_window_not_loaded');
}

async function openInBackground(): Promise<HhWindowState> {
  if (await isConnectorSessionOpen('hh')) return 'ready';
  const opened = await openConnectorSession('hh', HH_LOGIN_URL, undefined, { background: true });
  if (!opened.opened) throw new Error('hh_window_not_opened');
  return settleHhWindow();
}

/** Окно hh.ru одно: одновременные действия ждут одного открытия. */
let opening: Promise<HhWindowState> | null = null;

/**
 * B708: окна hh.ru после запуска приложения нет, а вход жив. Открывает окно в фоне и ждёт страницу.
 * Действие ещё не начато, поэтому ожидание и отказ здесь не дают второй отправки. Открытое окно не
 * трогает и не проверяет: вход видит само действие на своей странице.
 */
export function ensureHhWindow(): Promise<HhWindowState> {
  opening ??= openInBackground().finally(() => {
    opening = null;
  });
  return opening;
}

/** То же для чтения текущей страницы: и в открытом окне ждёт, пока страница определится со входом. */
export async function ensureSettledHhWindow(): Promise<HhWindowState> {
  return (await ensureHhWindow()) === 'signed_out' ? 'signed_out' : settleHhWindow();
}
