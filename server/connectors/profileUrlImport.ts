import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import { parseHhResumeFromUrl } from './hhResumeParser';

export type ProfilePlatform = 'linkedin' | 'hh';

export type ProfileUrlImportResult =
  | {
      status: 'imported';
      platform: ProfilePlatform;
      sourceUrl: string;
      capturedAt: string;
      accessPath: 'official_api' | 'permitted_public_page';
      facts: Array<{
        kind: 'headline' | 'summary';
        value: string;
        sourceLocator: string;
        confidence: 'public-metadata';
      }>;
      parsedResume?: ParsedResume;
    }
  | {
      status: 'unavailable';
      platform: ProfilePlatform;
      sourceUrl: string;
      reason:
        | 'authwall'
        | 'not-public'
        | 'network'
        | 'insufficient'
        | 'official-access-required';
      nextAction: 'upload_export_or_pdf' | 'oauth_or_export';
    };

export async function importProfileUrl(
  value: string,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => string;
  } = {},
): Promise<ProfileUrlImportResult> {
  const { url, platform } = parseProfileUrl(value);

  if (platform === 'hh') {
    return parseHhResumeFromUrl(url, options);
  }

  return {
    status: 'unavailable',
    platform,
    sourceUrl: url,
    reason: 'official-access-required',
    nextAction: 'oauth_or_export',
  };
}

export function parseProfileUrl(value: string): { url: string; platform: ProfilePlatform } {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('profile_url_invalid');
  const normalized = !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('profile_url_invalid');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('profile_url_invalid');
  if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/in\/[^/]+\/?$/u.test(url.pathname)) {
    return { url: url.toString(), platform: 'linkedin' };
  }
  if (
    (host === 'hh.ru' ||
      host.endsWith('.hh.ru') ||
      host === 'hh.kz' ||
      host.endsWith('.hh.kz') ||
      host === 'rabota.by' ||
      host.endsWith('.rabota.by')) &&
    /^\/resume\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
  ) {
    return { url: url.toString(), platform: 'hh' };
  }
  throw new Error('profile_url_invalid');
}
