import { parseHhResumeHtml, parseHhResumesList } from '../../services/connectors/hhResumeParser';
import type { ParsedResume } from '../workspace/resumeParser';
import type {
  SessionInspectionResult,
  SessionPageResult,
} from './connectorSession';
import { captureSignedInPage } from './sessionCapture';

const HH_RESUME_LIST_URL = 'https://hh.ru/applicant/resumes';

export interface HhResumeItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updatedLabel?: string;
}

/**
 * Why the flow is still waiting. One opaque "waiting" state made a loading
 * page, a one-time-code prompt and an unrecognised signed-in page look
 * identical on screen — nothing ever changed — and the last of those is the
 * failure the candidate can neither see nor act on (B157).
 */
export type HhWaitingStage =
  | 'loading'
  | 'login'
  | 'otp'
  | 'captcha'
  | 'unrecognised';

/**
 * How long an already-loaded, unchallenged hh.ru page may stay unrecognised
 * before the step admits it and offers the candidate the PDF route instead.
 * ~18 s at the 750 ms poll interval: long enough for a slow single-page
 * transition, short enough that nobody sits in front of a still screen.
 */
const UNRECOGNISED_PATIENCE_POLLS = 24;

export interface HhWaitingNotice {
  readonly text: string;
  /** The step has stopped making progress and must offer another route. */
  readonly stuck: boolean;
}

/**
 * What the candidate is told while the flow waits. A challenge hh.ru itself is
 * showing (code, captcha, its own sign-in form) is not a stall — the candidate
 * is the one being asked to act, so the flow waits as long as it takes. A page
 * that is loaded, unchallenged and still carries no signed-in marker is the
 * failure the owner reported, and it must eventually say so out loud (B157).
 */
export function hhWaitingNotice(
  stage: HhWaitingStage,
  unrecognisedPolls: number,
): HhWaitingNotice {
  switch (stage) {
    case 'loading':
      return { text: 'Загружаем страницу hh.ru…', stuck: false };
    case 'login':
      return {
        text: 'Ждём, пока вы войдёте в hh.ru в открывшемся окне.',
        stuck: false,
      };
    case 'otp':
      return {
        text: 'hh.ru запросил одноразовый код — введите его в окне входа.',
        stuck: false,
      };
    case 'captcha':
      return {
        text: 'hh.ru показывает проверку — пройдите её в окне входа.',
        stuck: false,
      };
    default:
      return unrecognisedPolls >= UNRECOGNISED_PATIENCE_POLLS
        ? {
            text: 'Вход выполнен, но OpenQareer не узнаёт страницу hh.ru. Откройте на hh.ru раздел «Мои резюме» или загрузите PDF-резюме.',
            stuck: true,
          }
        : { text: 'Проверяем, завершён ли вход…', stuck: false };
  }
}

export type HhSessionPollResult =
  | { readonly status: 'waiting_for_sign_in'; readonly stage: HhWaitingStage }
  | { readonly status: 'authenticated_empty' }
  | {
      readonly status: 'ready';
      readonly resumes: HhResumeItem[];
      readonly defaultParsed?: ParsedResume;
      readonly rawUrl?: string;
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
  readonly onProviderDataCaptured: (
    result: Exclude<HhSessionPollResult, { status: 'waiting_for_sign_in' }>,
  ) => void | Promise<void>;
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
        await dependencies.onProviderDataCaptured(result);
        if (result.status === 'authenticated_empty') {
          await dependencies.onAuthenticatedEmpty();
        } else {
          await dependencies.onReady(result);
        }
        return result;
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
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
    return { status: 'waiting_for_sign_in', stage: waitingStage(current) };
  }
  await dependencies.onAuthenticated?.();

  const listBody = await captureSignedInPage({
    read: () => dependencies.readSessionPage(HH_RESUME_LIST_URL),
    interpret: (page) => (isResumeListUrl(page.url) ? page.body : undefined),
    isChallenge: looksLikeAuthenticationChallenge,
    failureCode: 'hh_authenticated_capture_failed',
    waitBeforeRetry: dependencies.waitBeforeRetry,
  });
  const resumes = parseHhResumesList(listBody);
  if (resumes.length === 0) {
    if (looksLikeEmptyResumeList(listBody)) {
      return { status: 'authenticated_empty' };
    }
    throw new Error('hh_authenticated_capture_unclassified');
  }

  if (resumes.length > 1) {
    return {
      status: 'ready',
      resumes,
      defaultParsed: undefined,
      rawUrl: undefined,
    };
  }

  const first = resumes[0];
  const defaultParsed = await readHhResumeFromSession(
    first.url,
    dependencies.readSessionPage,
  ).catch(() => undefined);
  return {
    status: 'ready',
    resumes,
    defaultParsed,
    rawUrl: first.url,
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

/**
 * A page hh.ru itself is challenging outranks readiness: a captcha or a code
 * prompt is what the candidate must act on, whatever `readyState` says.
 */
function waitingStage(page: SessionInspectionResult): HhWaitingStage {
  if (page.captcha) return 'captcha';
  if (page.otp) return 'otp';
  if (page.login) return 'login';
  if (!page.ready) return 'loading';
  return 'unrecognised';
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
 * The path alone is not enough: a redirect to any host that happens to serve
 * `/applicant/resumes` would otherwise be parsed as the candidate's own hh.ru
 * resume list.
 */
function isResumeListUrl(rawUrl?: string): boolean {
  if (!rawUrl || !isAllowedHhUrl(rawUrl)) return false;
  try {
    return new URL(rawUrl).pathname === '/applicant/resumes';
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
