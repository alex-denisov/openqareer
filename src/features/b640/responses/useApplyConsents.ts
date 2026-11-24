import { useEffect, useState } from 'react';
import type { ApplyConsentEntry, ApplyConsentPage } from '../../../../shared/applyConsent';
import { apiFetch, readDataObject } from '../../coach/apiClient';

const NONE: readonly ApplyConsentEntry[] = [];
const PAGE = 50;

async function listApplyConsents(
  applicationId: string,
  signal: AbortSignal,
): Promise<readonly ApplyConsentEntry[]> {
  const query = new URLSearchParams({ applicationId, limit: String(PAGE) }).toString();
  const response = await apiFetch(`/api/v1/candidate/apply-consents?${query}`, { signal });
  return (await readDataObject<ApplyConsentPage>(response)).entries ?? NONE;
}

/** B787: согласия, подтверждённые по этому отклику; сбой чтения не прячет остальную историю. */
export function useApplyConsents(applicationId: string): readonly ApplyConsentEntry[] {
  const [loaded, setLoaded] = useState({ applicationId, entries: NONE });
  useEffect(() => {
    const controller = new AbortController();
    listApplyConsents(applicationId, controller.signal).then(
      (entries) => setLoaded({ applicationId, entries }),
      () => setLoaded({ applicationId, entries: NONE }),
    );
    return () => controller.abort();
  }, [applicationId]);
  return loaded.applicationId === applicationId ? loaded.entries : NONE;
}
