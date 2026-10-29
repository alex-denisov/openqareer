import type { RecruiterContact } from '../../shared/recruiterContact';

/** A new import entry as the merge sees it: its profile URL and stable id. */
export interface ImportedIdentity {
  readonly url: string | null | undefined;
  readonly id: string;
}

/**
 * Earlier imported contacts the new list does not name. The desktop read of
 * the connections list stops at its time cap, so a shorter list means "not
 * reached", not "removed": on 29.10 a capped read cut 1 888 people to 1 363.
 */
export function unreachedImportedContacts(
  existing: readonly RecruiterContact[],
  incoming: readonly ImportedIdentity[],
  contactIdOf: (record: RecruiterContact) => string | undefined,
): RecruiterContact[] {
  const urls = new Set(incoming.flatMap((entry) => profileKey(entry.url) ?? []));
  const ids = new Set(incoming.map((entry) => entry.id));
  return existing.filter((record) => {
    if (record.sourceType !== 'candidate_linkedin_connection') return false;
    const url = profileKey(record.linkedinUrl);
    if (url) return !urls.has(url);
    const contactId = contactIdOf(record);
    return contactId !== undefined && !ids.has(contactId);
  });
}

/** A profile URL compared without case or trailing slash. */
export function profileKey(url: string | null | undefined): string | undefined {
  const key = url?.trim().toLocaleLowerCase('und').replace(/\/+$/u, '');
  return key || undefined;
}

/** What a contact's company was before this import, and where it came from. */
export interface PriorCompanyPlace {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly companySource?: 'headline' | 'search';
  readonly companyObservedAt?: string;
}

export interface KeptCompanyPlace {
  readonly names: { readonly companyName: string; readonly roleTitle: string };
  readonly origin: {
    readonly companySource?: 'headline' | 'search';
    readonly companyObservedAt?: string;
  };
}

/**
 * The company an imported connection keeps (B561). Search reads the person's
 * current place from their experience, so it beats any headline; a headline
 * that names no company never wipes one already known.
 */
export function keptCompanyPlace(
  incoming: { readonly companyName: string; readonly roleTitle: string },
  prior: PriorCompanyPlace | undefined,
): KeptCompanyPlace {
  const keepPrior =
    prior !== undefined &&
    prior.companyName.trim() !== '' &&
    (prior.companySource === 'search' || incoming.companyName.trim() === '');
  if (keepPrior) {
    return {
      names: { companyName: prior.companyName, roleTitle: prior.roleTitle },
      origin: { companySource: prior.companySource, companyObservedAt: prior.companyObservedAt },
    };
  }
  return {
    names: { companyName: incoming.companyName, roleTitle: incoming.roleTitle },
    origin: incoming.companyName.trim() ? { companySource: 'headline' } : {},
  };
}

/**
 * Each earlier imported connection's company, by profile, so an import can
 * keep what it would otherwise wipe (B561).
 */
export function priorCompanyPlaces(
  existing: readonly RecruiterContact[],
  originOf: (
    record: RecruiterContact,
  ) => Omit<PriorCompanyPlace, 'companyName' | 'roleTitle'> | null,
): (url: string | null | undefined) => PriorCompanyPlace | undefined {
  const byProfile = new Map(
    existing.flatMap((record) => {
      const key = profileKey(record.linkedinUrl);
      if (!key || record.sourceType !== 'candidate_linkedin_connection') return [];
      const origin = originOf(record);
      const place: PriorCompanyPlace = {
        companyName: record.companyName,
        roleTitle: record.roleTitle,
        companySource: origin?.companySource,
        companyObservedAt: origin?.companyObservedAt,
      };
      return [[key, place] as const];
    }),
  );
  return (url) => byProfile.get(profileKey(url) ?? '');
}

export function isLinkedInProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLocaleLowerCase('und')) &&
      /^\/in\//u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** JSON with sorted keys, so equal imports digest equally. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stableJson(record[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}
