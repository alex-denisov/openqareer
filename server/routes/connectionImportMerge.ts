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

function profileKey(url: string | null | undefined): string | undefined {
  const key = url?.trim().toLocaleLowerCase('und').replace(/\/+$/u, '');
  return key || undefined;
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
