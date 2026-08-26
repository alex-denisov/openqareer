import {
  parseHhResumeHtml,
  parseHhResumesList,
} from '../../services/connectors/hhResumeParser';
import {
  parseHhProfilePage,
  withHhProfileIdentity,
  type HhProfileIdentity,
} from '../../services/connectors/hhProfileParser';
import type { ParsedResume } from '../workspace/resumeParser';
import type {
  SessionInspectionResult,
  SessionPageResult,
} from './connectorSession';
import { captureSignedInPage } from './sessionCapture';
import {
  sessionWaitingNotice,
  sessionWaitingStage,
  type SessionWaitingNotice,
  type SessionWaitingStage,
} from './sessionWaitingStage';

const HH_RESUME_LIST_URL = 'https://hh.ru/applicant/resumes';

export interface HhResumeItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updatedLabel?: string;
}

export type HhWaitingStage = SessionWaitingStage;
export type HhWaitingNotice = SessionWaitingNotice;

const HH_WAITING_COPY = {
  loading: 'Загружаем страницу hh.ru…',
  login: 'Ждём, пока вы войдёте в hh.ru в открывшемся окне.',
  otp: 'hh.ru запросил одноразовый код — введите его в окне входа.',
  captcha: 'hh.ru показывает проверку — пройдите её в окне входа.',
  checking: 'Проверяем, завершён ли вход…',
  unrecognised:
    'Вход выполнен, но OpenQareer не узнаёт страницу hh.ru. Откройте на hh.ru раздел «Мои резюме» или загрузите PDF-резюме.',
} as const;

export function hhWaitingNotice(
  stage: HhWaitingStage,
  unrecognisedPolls: number,
): HhWaitingNotice {
  return sessionWaitingNotice(stage, unrecognisedPolls, HH_WAITING_COPY);
}

export type HhSessionPollResult =
  | { readonly status: 'waiting_for_sign_in'; readonly stage: HhWaitingStage }
  | { readonly status: 'authenticated_empty' }
  | {
      readonly status: 'ready';
      readonly resumes: HhResumeItem[];
      readonly defaultParsed?: ParsedResume;
      readonly rawUrl?: string;
      /**
       * What the account's own profile page states — the name above all, which
       * hh.ru no longer renders on the resume page at all (B172).
       */
      readonly profile: HhProfileIdentity;
    };

interface HhSessionPollDependencies {
  readonly inspectCurrentPage: () => Promise<SessionInspectionResult>;
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  readonly onAuthenticated?: () => void | Promise<void>;
  /** Injected so tests do not sit through the real backoff. */
  readonly waitBeforeRetry?: (attempt: number) => Promise<void>;
}

export interface HhSessionPoller {
  /** Concurrent calls share the whole inspect -> list -> first-resume operation. */
  readonly poll: () => Promise<HhSessionPollResult>;
}

interface HhSessionImportFlowDependencies extends HhSessionPollDependencies {
  readonly onAuthenticated: () => void | Promise<void>;
  /**
   * The account owes the wizard a choice: several resumes, or a single one
   * whose page did not read on the first pass. The sign-in window stays on
   * screen — the chosen resume is read inside it.
   */
  readonly onChoiceRequired: (
    result: Extract<HhSessionPollResult, { status: 'ready' }>,
  ) => void | Promise<void>;
  /** Exactly one resume, already read: nothing is left to ask. */
  readonly onReady: (
    result: Extract<HhSessionPollResult, { status: 'ready' }>,
  ) => void | Promise<void>;
  readonly onAuthenticatedEmpty: () => void | Promise<void>;
}

export interface HhSessionImportFlow {
  readonly run: () => Promise<HhSessionPollResult>;
}

/** Keeps provider capture plus the downstream persisted import single-flight. */
export function createHhSessionImportFlow(
  dependencies: HhSessionImportFlowDependencies,
): HhSessionImportFlow {
  const poller = createHhSessionPoller(dependencies);
  let inFlight: Promise<HhSessionPollResult> | undefined;
  return {
    run() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const result = await poller.poll();
        if (result.status === 'waiting_for_sign_in') return result;
        if (result.status === 'authenticated_empty') {
          await dependencies.onAuthenticatedEmpty();
          return result;
        }
        // Announcing a finished import here is what closed the dialog while
        // its sign-in window stayed on screen with nothing left to own it
        // (owner report, 2026-08-26). An unfinished capture is a question, and
        // a question keeps its window.
        if (!result.defaultParsed || !result.rawUrl || result.resumes.length > 1) {
          await dependencies.onChoiceRequired(result);
          return result;
        }
        await dependencies.onReady(result);
        return result;
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

export interface ChosenHhResumeDependencies {
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  /**
   * Puts the candidate's own sign-in window back when it is gone. The cookie
   * jar outlives the window, so a reopened window is still signed in.
   */
  readonly reopenSession: (url: string) => Promise<boolean>;
}

/**
 * Reads the resume the candidate picked, and survives a window they closed.
 *
 * The picker used to read through a window the dialog had already orphaned:
 * `read_session_page` answered `session_window_missing`, and the candidate was
 * told «Импортировать выбранное резюме не удалось» with no cause and no way
 * out (owner report, 2026-08-26).
 */
export async function readChosenHhResume(
  url: string,
  dependencies: ChosenHhResumeDependencies,
  /** What the account's profile page stated, when the poll already read it. */
  profile?: HhProfileIdentity,
): Promise<ParsedResume> {
  let parsed = await readResumeOrMissingWindow(url, dependencies.readSessionPage);
  if (parsed === WINDOW_MISSING) {
    if (!(await dependencies.reopenSession(url))) {
      throw new Error('hh_session_window_gone');
    }
    parsed = await readResumeOrMissingWindow(url, dependencies.readSessionPage);
    if (parsed === WINDOW_MISSING) throw new Error('hh_session_window_gone');
  }
  if (!parsed) throw new Error('hh_resume_not_read');
  return profile ? withHhProfileIdentity(parsed, profile) : parsed;
}

/** Says which of the two things went wrong, in words the candidate can act on. */
export function hhResumeImportFailure(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  switch (raw.split(':')[0].trim()) {
    case 'hh_session_window_gone':
      return 'Окно hh.ru закрылось, и открыть его заново не удалось. Повторите импорт или закройте это окно и подключите hh.ru ещё раз.';
    case 'hh_resume_not_read':
      return 'Страница выбранного резюме не прочиталась. Выберите другое резюме, повторите попытку или загрузите PDF-резюме.';
    case 'hh_native_connection_not_persisted':
    case 'native_connection_receipt_missing':
      return 'Резюме прочитано, но сервер не подтвердил сохранение в профиль. Повторите импорт или загрузите PDF-резюме.';
    default:
      // Anything else is the server's own sentence about its own refusal —
      // «в документе не нашлось ни одного факта», a rate limit, an expired
      // session. It is always more useful than a house-brand apology, and
      // hiding it is what left the owner with an unexplained dead end
      // (owner report, 2026-08-26).
      return raw.trim().length > 24
        ? `Резюме прочитано, но импорт отклонён: ${raw.trim()}`
        : 'Импортировать выбранное резюме не удалось. Повторите попытку или загрузите PDF-резюме.';
  }
}

/** Distinguishes "no window" from "no readable resume" without a second type. */
const WINDOW_MISSING = Symbol('hh_session_window_missing');

async function readResumeOrMissingWindow(
  url: string,
  readSessionPage: (url: string) => Promise<SessionPageResult>,
): Promise<ParsedResume | undefined | typeof WINDOW_MISSING> {
  try {
    return await readHhResumeFromSession(url, readSessionPage);
  } catch (reason) {
    if (isSessionWindowMissing(reason)) return WINDOW_MISSING;
    throw reason;
  }
}

/** The desktop bridge rejects with a bare code string, not with an `Error`. */
function isSessionWindowMissing(reason: unknown): boolean {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  return raw.split(':')[0].trim() === 'session_window_missing';
}

/** Reads one explicitly selected resume inside the already signed-in webview. */
export async function readHhResumeFromSession(
  url: string,
  readCurrentSession: (url: string) => Promise<SessionPageResult>,
): Promise<ParsedResume | undefined> {
  const page = await readCurrentSession(url);
  if (!page.ok || !page.body || !sameResumeUrl(page.url, url)) return undefined;
  const parsed = parseHhResumeHtml(page.body, url);
  return parsed.rawText.trim() ? parsed : undefined;
}

/**
 * Polls the candidate-owned hh.ru webview without touching its current page
 * until the page itself contains a positive signed-in applicant marker.
 */
export function createHhSessionPoller(
  dependencies: HhSessionPollDependencies,
): HhSessionPoller {
  let inFlight: Promise<HhSessionPollResult> | undefined;
  return {
    poll() {
      if (inFlight) return inFlight;
      inFlight = pollOnce(dependencies).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

async function pollOnce(
  dependencies: HhSessionPollDependencies,
): Promise<HhSessionPollResult> {
  const current = await dependencies.inspectCurrentPage();
  if (!isSignedInApplicantPage(current)) {
    return { status: 'waiting_for_sign_in', stage: sessionWaitingStage(current) };
  }
  await dependencies.onAuthenticated?.();

  /**
   * The list is only "read" once it says something: a page that parsed to zero
   * resumes and does not declare itself empty is a page that has not finished
   * rendering. Deciding that outside the retry turned one early read into
   * «вход выполнен, но список резюме прочитать не удалось», and the very next
   * attempt succeeded (owner report, 2026-08-26).
   */
  // hh.ru serves the resume list on the account's profile page, so the same
  // capture already carries the name, the city and the languages the resume
  // page itself no longer renders (B172).
  const captured = await captureSignedInPage({
    read: () => dependencies.readSessionPage(HH_RESUME_LIST_URL),
    interpret: (page) => {
      if (!isResumeListUrl(page.url)) return undefined;
      const listed = parseHhResumesList(page.body);
      const profile = parseHhProfilePage(page.body);
      if (listed.length > 0) return { resumes: listed, profile };
      return looksLikeEmptyResumeList(page.body) ? { resumes: [], profile } : undefined;
    },
    isChallenge: looksLikeAuthenticationChallenge,
    failureCode: 'hh_authenticated_capture_failed',
    waitBeforeRetry: dependencies.waitBeforeRetry,
  });
  const { resumes, profile } = captured;
  if (resumes.length === 0) return { status: 'authenticated_empty' };

  if (resumes.length > 1) {
    return {
      status: 'ready',
      resumes,
      defaultParsed: undefined,
      rawUrl: undefined,
      profile,
    };
  }

  const first = resumes[0];
  const read = await readHhResumeFromSession(
    first.url,
    dependencies.readSessionPage,
  ).catch(() => undefined);
  return {
    status: 'ready',
    resumes,
    defaultParsed: read ? withHhProfileIdentity(read, profile) : undefined,
    rawUrl: first.url,
    profile,
  };
}

function sameResumeUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return (
      isAllowedHhUrl(actual) &&
      isAllowedHhUrl(expected) &&
      actualUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

function isSignedInApplicantPage(page: SessionInspectionResult): boolean {
  return (
    page.ready &&
    page.signedInApplicant &&
    !page.login &&
    !page.otp &&
    !page.captcha &&
    isAllowedHhUrl(page.url)
  );
}

/**
 * The applicant surfaces that really carry this candidate's resume list.
 *
 * hh.ru answers `/applicant/resumes` with a redirect to
 * `/applicant/profile/me`, and the capture rejected the very page it had just
 * asked for: three reads, then "вход выполнен, но получить данные профиля не
 * удалось" on a screen that was plainly showing the candidate their own
 * resumes (owner report, B157).
 *
 * The host check stays: a redirect to any other host that happens to serve one
 * of these paths must never be read as the candidate's resume list.
 */
function isResumeListUrl(rawUrl?: string): boolean {
  if (!rawUrl || !isAllowedHhUrl(rawUrl)) return false;
  try {
    const path = new URL(rawUrl).pathname.replace(/\/+$/u, '');
    return (
      path === '/applicant/resumes' ||
      path === '/applicant/profile' ||
      path === '/applicant/profile/me'
    );
  } catch {
    return false;
  }
}

function looksLikeAuthenticationChallenge(body: string): boolean {
  return /account\/login|account-login-page|otp-code-input|autocomplete=["']one-time-code|data-qa=["']captcha|id=["']captcha/iu.test(
    body,
  );
}

function looksLikeEmptyResumeList(body: string): boolean {
  return /data-qa=["'](?:applicant-resumes-empty|resume-empty)["']|(?:резюме пока нет|нет (?:ни одного )?резюме|создайте (?:своё )?резюме)/iu.test(
    body,
  );
}

function isAllowedHhUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'hh.ru' || host.endsWith('.hh.ru') || host === 'headhunter.ru' || host.endsWith('.headhunter.ru'))
    );
  } catch {
    return false;
  }
}
