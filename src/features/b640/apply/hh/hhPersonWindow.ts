import {
  inspectSessionPage,
  isConnectorSessionOpen,
  openConnectorSession,
  parkConnectorSession,
  showConnectorSession,
} from '../../../connections/connectorSession';
import { reportHhAlive } from './hhAlive';
import { HH_LOGIN_URL } from './hhWindow';

const WATCH_STEP_MS = 1_500;
const WATCH_LIMIT_MS = 15 * 60 * 1000;
/** Столько чтений подряд без просьб к человеку: страница могла показаться на миг. */
const SETTLED_READS = 2;

let current: symbol | null = null;

/** Человек закончил в окне hh.ru — окно снова скрыто, ответ `true`. `needSeen`: сначала страница должна его попросить. */
async function hideWhenDone(needSeen: boolean): Promise<boolean> {
  const own = Symbol('hh-person-window');
  current = own;
  const deadline = Date.now() + WATCH_LIMIT_MS;
  let asked = !needSeen;
  let settled = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, WATCH_STEP_MS));
    if (current !== own || !(await isConnectorSessionOpen('hh'))) return false;
    const page = await inspectSessionPage('hh').catch(() => null);
    if (!page?.ready) continue;
    const asks = page.login || page.otp || page.captcha || !page.signedInApplicant;
    asked ||= asks;
    settled = asks ? 0 : settled + 1;
    if (!asked || settled < SETTLED_READS) continue;
    if (current === own) await parkConnectorSession('hh').catch(() => false);
    await reportHhAlive();
    return true;
  }
  return false;
}

/** Окно входа hh.ru по нажатию кандидата; после входа скрывается само. */
export async function openHhSignIn(): Promise<boolean> {
  const { opened } = await openConnectorSession('hh', HH_LOGIN_URL);
  if (opened) void hideWhenDone(false);
  return opened;
}

/** То же, но ждёт исхода: `true` — кандидат вошёл, `false` — окно не открылось или закрыто. */
export async function signInToHh(): Promise<boolean> {
  const { opened } = await openConnectorSession('hh', HH_LOGIN_URL);
  return opened && hideWhenDone(false);
}

/** Капча hh.ru: окно как есть, без перехода; нет окна — вход. После проверки скрывается само. */
export async function showHhCaptcha(): Promise<boolean> {
  if (!(await showConnectorSession('hh'))) return openHhSignIn();
  void hideWhenDone(true);
  return true;
}

/** Незавершённый отклик: кандидат заканчивает его сам, поэтому окно скроет отправка. */
export async function showHhResponse(): Promise<boolean> {
  current = null;
  return (await showConnectorSession('hh')) || openHhSignIn();
}

/** Подтверждённое кандидатом действие начинается в скрытом окне. */
export async function hideHhWindow(): Promise<void> {
  current = null;
  await parkConnectorSession('hh').catch(() => false);
}
