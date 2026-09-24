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
const DETAIL_PAGE_PATHS: Readonly<Record<Exclude<keyof LinkedInProfilePages, 'profile' | 'achievements' | 'openToWork'>, string>> = {
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

/**
 * Reads the fixed detail pages by URL (architecture §3: navigation, never a
 * synthetic click or dispatched event) and runs them through the structured
 * extractor. Every read is best-effort: a missing or oversized section is
 * dropped, not fatal, so a partial capture still improves on the text parse.
 * Sanitised and schema-invalid profiles fall back to the text path entirely
 * (M2 cases 22-23) so nothing half-broken reaches the server.
 */
async function captureStructuredProfile(
  dependencies: LinkedInSessionImportFlowDependencies,
  page: { readonly body: string; readonly url: string },
): Promise<{ readonly profile: LinkedInProfileV2; readonly extractorVersion: string } | undefined> {
  const base = new URL(page.url);
  const pages: Record<string, string> = { profile: page.body };
  const achievements: { kind: string; html: string }[] = [];
  for (const [key, path] of Object.entries(DETAIL_PAGE_PATHS)) {
    const detailUrl = new URL(path, base.href.endsWith('/') ? base.href : `${base.href}/`).toString();
    const detail = await dependencies.readSessionPage(detailUrl).catch(() => ({ ok: false as const }));
    if (detail.ok && detail.body && detail.body.length <= MAX_DETAIL_PAGE_BYTES) {
      pages[key] = detail.body;
    }
  }
  const structured = extractStructuredLinkedInProfile({
    profile: pages.profile,
    experience: pages.experience,
    education: pages.education,
    skills: pages.skills,
    certifications: pages.certifications,
    projects: pages.projects,
    contactInfo: pages.contactInfo,
    recommendations: pages.recommendations,
    achievements: achievements.length > 0 ? (achievements as never) : undefined,
  });
  if (!hasStructuredSubstance(structured)) return undefined;
  const valid = sanitizedAndValidLinkedInProfile(structured);
  if (!valid) return undefined;
  return { profile: valid, extractorVersion: LI_SDUI_EXTRACTOR_VERSION };
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
