import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
import { extractLinkedInProfile } from './linkedinProfileExtract';
import {
  extractStructuredLinkedInProfile,
  LI_SDUI_EXTRACTOR_VERSION,
  type LinkedInProfilePages,
} from './linkedinProfileStructuredExtract';
import {
  hasStructuredSubstance,
  sanitizedAndValidLinkedInProfile,
} from './linkedinProfileSanitize';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';
import type { SessionInspectionResult, SessionPageResult } from './connectorSession';
import { captureSignedInPage } from './sessionCapture';
import {
  sessionWaitingNotice,
  sessionWaitingStage,
  type SessionWaitingNotice,
  type SessionWaitingStage,
} from './sessionWaitingStage';

const LINKEDIN_PROFILE_URL = 'https://www.linkedin.com/in/me/';

/**
 * Fixed LinkedIn detail-page paths read after the main profile (architecture
 * §3): one navigation per section, no synthetic clicks. Recommendations only
 * pulls "Received" (architecture §2) and contact info is the overlay route.
 */
const DETAIL_PAGE_PATHS: Readonly<
  Record<Exclude<keyof LinkedInProfilePages, 'profile' | 'achievements' | 'openToWork'>, string>
> = {
  experience: 'details/experience/',
  education: 'details/education/',
  skills: 'details/skills/',
  certifications: 'details/certifications/',
  projects: 'details/projects/',
  contactInfo: 'overlay/contact-info/',
  recommendations: 'details/recommendations/received/',
};

export type LinkedInWaitingStage = SessionWaitingStage;
export type LinkedInWaitingNotice = SessionWaitingNotice;

const LINKEDIN_WAITING_COPY = {
  loading: 'Загружаем страницу LinkedIn…',
  login: 'Ждём, пока вы войдёте в LinkedIn в открывшемся окне.',
  otp: 'LinkedIn запросил одноразовый код — введите его в окне входа.',
  captcha: 'LinkedIn показывает проверку — пройдите её в окне входа.',
  checking: 'Проверяем, завершён ли вход…',
  unrecognised:
    'Вход выполнен, но OpenQareer не узнаёт страницу LinkedIn. Откройте свой профиль в окне LinkedIn или загрузите PDF-экспорт профиля.',
} as const;

/** What the candidate is told while the LinkedIn sign-in is still running. */
export function linkedinWaitingNotice(
  stage: LinkedInWaitingStage,
  unrecognisedPolls: number,
): LinkedInWaitingNotice {
  return sessionWaitingNotice(stage, unrecognisedPolls, LINKEDIN_WAITING_COPY);
}

export type LinkedInSessionPollResult =
  | {
      readonly status: 'waiting_for_sign_in';
      readonly stage: LinkedInWaitingStage;
    }
  | {
      readonly status: 'ready';
      readonly parsed: ParsedResume;
      readonly rawUrl: string;
      readonly accountMarker?: string | null;
      /** Present only when the structured capture yielded a valid, non-empty profile. */
      readonly structured?: {
        readonly profile: LinkedInProfileV2;
        readonly extractorVersion: string;
      };
    };

interface LinkedInSessionImportFlowDependencies {
  readonly inspectCurrentPage: () => Promise<SessionInspectionResult>;
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  readonly onAuthenticated: () => void | Promise<void>;
  readonly onProviderDataCaptured: () => void | Promise<void>;
  readonly onReady: (
    result: Extract<LinkedInSessionPollResult, { status: 'ready' }>,
  ) => void | Promise<void>;
  /** Injected so tests do not sit through the real capture backoff. */
  readonly waitBeforeRetry?: (attempt: number) => Promise<void>;
  /** Human-paced gap before each detail page (architecture §3: 3–8 s). */
  readonly pauseBetweenDetailReads?: () => Promise<void>;
  /** Remembers the last detail-page read so LinkedIn is walked at most once per 12 h. */
  readonly detailReadThrottle?: DetailReadThrottle;
}

export interface DetailReadThrottle {
  readonly lastReadAt: () => number | undefined;
  readonly markRead: (at: number) => void;
}

export interface LinkedInSessionImportFlow {
  readonly run: () => Promise<LinkedInSessionPollResult>;
}

/**
 * Reads only the candidate's own profile after the classified login boundary.
 * Concurrent timer/manual checks share capture and downstream persistence.
 */
export function createLinkedInSessionImportFlow(
  dependencies: LinkedInSessionImportFlowDependencies,
): LinkedInSessionImportFlow {
  let inFlight: Promise<LinkedInSessionPollResult> | undefined;
  return {
    run() {
      if (inFlight) return inFlight;
      inFlight = runOnce(dependencies).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

async function runOnce(
  dependencies: LinkedInSessionImportFlowDependencies,
): Promise<LinkedInSessionPollResult> {
  const current = await dependencies.inspectCurrentPage();
  if (!isSignedInLinkedInPage(current)) {
    return { status: 'waiting_for_sign_in', stage: sessionWaitingStage(current) };
  }
  await dependencies.onAuthenticated();
  const page = await captureSignedInPage({
    read: () => dependencies.readSessionPage(LINKEDIN_PROFILE_URL),
    interpret: (candidate) =>
      isOwnProfileUrl(candidate.url) ? { body: candidate.body, url: candidate.url } : undefined,
    failureCode: 'linkedin_authenticated_capture_failed',
    waitBeforeRetry: dependencies.waitBeforeRetry,
  });
  const profile = extractLinkedInProfile(page.body);
  if (profile.text.length > 500_000) throw new Error('linkedin_profile_payload_too_large');
  const parsedBase = parseResumeContent(profile.text);
  const parsed = {
    ...parsedBase,
    fullName: profile.fullName ?? parsedBase.fullName,
    rawText: profile.text,
  };
  if (!parsed.fullName && parsed.experience.length === 0) {
    throw new Error('linkedin_authenticated_profile_unclassified');
  }
  const structured = await captureStructuredProfile(dependencies, page);
  const result = {
    status: 'ready' as const,
    ...(structured ? { structured } : {}),
    parsed,
    rawUrl: page.url,
    ...(current.accountMarker ? { accountMarker: current.accountMarker } : {}),
  };
  await dependencies.onProviderDataCaptured();
  await dependencies.onReady(result);
  return result;
}

function isSignedInLinkedInPage(page: SessionInspectionResult): boolean {
  return (
    page.ready &&
    page.signedInApplicant &&
    !page.login &&
    !page.otp &&
    !page.captcha &&
    isAllowedLinkedInUrl(page.url)
  );
}

const MAX_DETAIL_PAGE_BYTES = 2 * 1_024 * 1_024;
/** Hard cap on detail pages per connection, contact info not counted (architecture §3). */
export const MAX_DETAIL_PAGES_PER_READ = 6;
export const DETAIL_READ_INTERVAL_MS = 12 * 60 * 60 * 1_000;
const DETAIL_PAUSE_MIN_MS = 3_000;
const DETAIL_PAUSE_MAX_MS = 8_000;
const DETAIL_READ_STORAGE_KEY = 'openqareer.linkedin.lastDetailReadAt';

function humanPause(): Promise<void> {
  const span = DETAIL_PAUSE_MAX_MS - DETAIL_PAUSE_MIN_MS;
  const delay = DETAIL_PAUSE_MIN_MS + Math.random() * span;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const storageThrottle: DetailReadThrottle = {
  lastReadAt: () => {
    try {
      const raw = globalThis.localStorage?.getItem(DETAIL_READ_STORAGE_KEY);
      const at = raw ? Number(raw) : Number.NaN;
      return Number.isFinite(at) ? at : undefined;
    } catch {
      return undefined;
    }
  },
  markRead: (at) => {
    try {
      globalThis.localStorage?.setItem(DETAIL_READ_STORAGE_KEY, String(at));
    } catch {
      // Storage may be unavailable; the Rust-side limit still applies.
    }
  },
};

type DetailPageKey = keyof typeof DETAIL_PAGE_PATHS;

/**
 * The fixed section list, capped at `MAX_DETAIL_PAGES_PER_READ` detail pages
 * plus the contact-info overlay. Choosing sections by the profile's own
 * "Show all" links waits for a capture that keeps `href` (B266 follow-up):
 * the current fixtures were taken with hrefs stripped.
 */
export function detailPagesToRead(): DetailPageKey[] {
  const keys = Object.keys(DETAIL_PAGE_PATHS) as DetailPageKey[];
  const details = keys.filter((key) => key !== 'contactInfo').slice(0, MAX_DETAIL_PAGES_PER_READ);
  return [...details, 'contactInfo'];
}

/**
 * Reads the detail pages by URL (architecture §3: navigation, never a
 * synthetic click or dispatched event), one human-paced step at a time, and
 * runs them through the structured extractor. The first failed read stops the
 * walk (it may be a checkpoint). Within 12 h of the last walk only the main
 * page is used. Schema-invalid profiles fall back to the text path (M2).
 */
async function captureStructuredProfile(
  dependencies: LinkedInSessionImportFlowDependencies,
  page: { readonly body: string; readonly url: string },
): Promise<{ readonly profile: LinkedInProfileV2; readonly extractorVersion: string } | undefined> {
  const pages = { profile: page.body, ...(await readLinkedDetailPages(dependencies, page)) };
  let structured: LinkedInProfileV2;
  try {
    structured = extractStructuredLinkedInProfile(pages);
  } catch {
    // Markup drift must degrade to the text path, never sink the import.
    return undefined;
  }
  if (!hasStructuredSubstance(structured)) return undefined;
  const valid = sanitizedAndValidLinkedInProfile(structured);
  if (!valid) return undefined;
  return { profile: valid, extractorVersion: LI_SDUI_EXTRACTOR_VERSION };
}

async function readLinkedDetailPages(
  dependencies: LinkedInSessionImportFlowDependencies,
  page: { readonly body: string; readonly url: string },
): Promise<Partial<Record<DetailPageKey, string>>> {
  const throttle = dependencies.detailReadThrottle ?? storageThrottle;
  const last = throttle.lastReadAt();
  const now = Date.now();
  if (last !== undefined && now - last < DETAIL_READ_INTERVAL_MS) return {};
  const keys = detailPagesToRead();
  throttle.markRead(now);
  const pause = dependencies.pauseBetweenDetailReads ?? humanPause;
  const base = page.url.endsWith('/') ? page.url : `${page.url}/`;
  let read: Partial<Record<DetailPageKey, string>> = {};
  for (const key of keys) {
    await pause();
    const detail = await dependencies
      .readSessionPage(new URL(DETAIL_PAGE_PATHS[key], base).toString())
      .catch(() => ({ ok: false as const }));
    // A redirect to /checkpoint/, /authwall or a captcha still answers ok=true:
    // anything but the requested section ends the walk (security review B266).
    if (!detail.ok || !detail.body || !landedOn(detail.url, DETAIL_PAGE_PATHS[key])) break;
    if (detail.body.length <= MAX_DETAIL_PAGE_BYTES) read = { ...read, [key]: detail.body };
  }
  return read;
}

function landedOn(rawUrl: string | undefined, sectionPath: string): boolean {
  if (!rawUrl || !isAllowedLinkedInUrl(rawUrl)) return false;
  return new URL(rawUrl).pathname.includes(`/${sectionPath}`);
}

function isOwnProfileUrl(rawUrl?: string): rawUrl is string {
  if (!rawUrl || !isAllowedLinkedInUrl(rawUrl)) return false;
  const path = new URL(rawUrl).pathname;
  return /^\/in\/[^/]+\/?$/u.test(path);
}

function isAllowedLinkedInUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'linkedin.com' ||
        host.endsWith('.linkedin.com') ||
        host === 'linkedin.cn' ||
        host.endsWith('.linkedin.cn'))
    );
  } catch {
    return false;
  }
}
