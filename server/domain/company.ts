import type { AtsProvider } from '../vacancies/atsBoardAdapters';

export type CompanyAttributeKey =
  | 'relocation'
  | 'currency_remote'
  | 'full_remote'
  | 'russian_founded_abroad'
  | 'domain_tag';

export type ClaimStatus = 'claimed_by_source' | 'verified_by_live_vacancy';

export interface CompanyProvenance {
  readonly source: string;
  readonly sourceLabel: string;
  readonly readAt: string;
  readonly route?: string;
  readonly rawNote?: string;
  readonly tier?: string;
}

export interface CompanyAttributeClaim {
  readonly key: CompanyAttributeKey;
  readonly value: boolean | string;
  readonly status: ClaimStatus;
  readonly provenance: CompanyProvenance;
  readonly verifiedAt?: string;
  readonly verifiedVacancyId?: string;
}

export interface CompanyLocation {
  readonly city?: string;
  readonly country?: string;
  readonly countryCode?: string;
  readonly coordinates?: {
    readonly lat: number;
    readonly lng: number;
  };
}

export interface Company {
  readonly id: string;
  readonly name: string;
  readonly canonicalName: string;
  readonly domain?: string;
  readonly careersUrl?: string;
  readonly linkedinUrl?: string;
  readonly industry?: string;
  readonly locations: readonly CompanyLocation[];
  readonly atsProvider?: AtsProvider | string;
  readonly atsBoardToken?: string;
  readonly attributes: readonly CompanyAttributeClaim[];
  readonly verifiedVacanciesCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Normalizes company name into an alphanumeric slug for cross-list comparison.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.\s\-_()[\]{}&'"+]/g, '');
}

/**
 * Extracts clean domain hostname from careers URL or company website.
 */
export function extractDomainFromUrl(url?: string): string | undefined {
  if (!url || typeof url !== 'string') {
    return undefined;
  }
  const clean = url.trim();
  if (!clean) {
    return undefined;
  }

  try {
    const withProto = clean.startsWith('http://') || clean.startsWith('https://')
      ? clean
      : `https://${clean}`;
    const parsed = new URL(withProto);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    const parts = host.split('.');
    if (parts.length > 2) {
      const specialTwoPartTlds = ['co.uk', 'com.ru', 'org.uk', 'gov.ru'];
      const lastTwo = parts.slice(-2).join('.');
      if (specialTwoPartTlds.includes(lastTwo) && parts.length > 3) {
        return parts.slice(-3).join('.');
      }
      if (!specialTwoPartTlds.includes(lastTwo)) {
        return parts.slice(-2).join('.');
      }
    }
    return host;
  } catch {
    return undefined;
  }
}

export interface ClaimDisplay {
  readonly label: string;
  readonly verified: boolean;
  readonly source: string;
}

/**
 * Returns user-facing honest label for an attribute claim.
 * Prevents unverified external claims from being portrayed as verified product facts.
 */
export function formatClaimDisplay(claim: CompanyAttributeClaim): ClaimDisplay {
  const verified = claim.status === 'verified_by_live_vacancy';
  return {
    verified,
    label: verified
      ? 'подтверждено живой вакансией'
      : 'заявлено списком, не подтверждено',
    source: claim.provenance.sourceLabel,
  };
}
