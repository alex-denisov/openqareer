import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
import type { SessionInspectionResult, SessionPageResult } from './connectorSession';
import { captureSignedInPage } from './sessionCapture';

const LINKEDIN_PROFILE_URL = 'https://www.linkedin.com/in/me/';

type LinkedInSessionPollResult =
  | { readonly status: 'waiting_for_sign_in' }
  | {
      readonly status: 'ready';
      readonly parsed: ParsedResume;
      readonly rawUrl: string;
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
    return { status: 'waiting_for_sign_in' };
  }
  await dependencies.onAuthenticated();
  const page = await captureSignedInPage({
    read: () => dependencies.readSessionPage(LINKEDIN_PROFILE_URL),
    interpret: (candidate) =>
      isOwnProfileUrl(candidate.url)
        ? { body: candidate.body, url: candidate.url }
        : undefined,
    failureCode: 'linkedin_authenticated_capture_failed',
    waitBeforeRetry: dependencies.waitBeforeRetry,
  });
  const profileText = htmlToProfileText(page.body);
  const parsedBase = parseResumeContent(profileText);
  const parsed = {
    ...parsedBase,
    fullName: extractHeading(page.body) ?? parsedBase.fullName,
    rawText: profileText,
  };
  if (!parsed.fullName && parsed.experience.length === 0) {
    throw new Error('linkedin_authenticated_profile_unclassified');
  }
  const result = { status: 'ready' as const, parsed, rawUrl: page.url };
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

function extractHeading(html: string): string | undefined {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/iu.exec(html);
  return match?.[1]
    ?.replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim() || undefined;
}

function htmlToProfileText(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(html)?.[1] ?? html;
  const text = main
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/h\d)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (text.length > 500_000) throw new Error('linkedin_profile_payload_too_large');
  return text;
}
