import { parseHhResumeHtml, parseHhResumesList } from '../../services/connectors/hhResumeParser';
import type { ParsedResume } from '../workspace/resumeParser';
import type {
  SessionInspectionResult,
  SessionPageResult,
} from './connectorSession';

const HH_RESUME_LIST_URL = 'https://hh.ru/applicant/resumes';

export interface HhResumeItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updatedLabel?: string;
}

type HhSessionPollResult =
  | { readonly status: 'waiting_for_sign_in' }
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
    return { status: 'waiting_for_sign_in' };
  }
  await dependencies.onAuthenticated?.();

  const listPage = await dependencies.readSessionPage(HH_RESUME_LIST_URL);
  if (
    !listPage.ok ||
    !listPage.body ||
    !isResumeListUrl(listPage.url) ||
    looksLikeAuthenticationChallenge(listPage.body)
  ) {
    throw new Error('hh_authenticated_capture_failed');
  }
  const resumes = parseHhResumesList(listPage.body);
  if (resumes.length === 0) {
    if (looksLikeEmptyResumeList(listPage.body)) {
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

function isResumeListUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
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
