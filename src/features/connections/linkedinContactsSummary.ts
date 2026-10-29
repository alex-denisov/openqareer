import { useEffect, useState } from 'react';
import {
  listCandidateConnectionContacts,
  type CandidateConnectionContactsPage,
} from '../outreach/connectionContactsApi';
import type { LinkedInContactsSummary } from '../account/AccountDialogs';

/** `null` — the server has no LinkedIn contacts read yet. */
export function toLinkedInContactsSummary(
  page: Pick<CandidateConnectionContactsPage, 'linkedinImport'>,
): LinkedInContactsSummary | null {
  const { state, importedAt, importedCount } = page.linkedinImport;
  return state === 'imported' && importedAt && importedCount !== null
    ? { importedCount, importedAt }
    : null;
}

/**
 * The LinkedIn manage dialog says how many contacts the background read
 * brought in (29.10). `undefined` while loading or after a failed load: the
 * line is then left out rather than showing a guess.
 */
export function useLinkedInContactsSummary(
  open: boolean,
): LinkedInContactsSummary | null | undefined {
  const [summary, setSummary] = useState<LinkedInContactsSummary | null | undefined>();
  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    listCandidateConnectionContacts(0)
      .then((page) => {
        if (current) setSummary(toLinkedInContactsSummary(page));
      })
      .catch(() => {
        if (current) setSummary(undefined);
      });
    return () => {
      current = false;
    };
  }, [open]);
  return open ? summary : undefined;
}
