import { useEffect, useState } from 'react';
import type { B640ResponseSummary } from '../../../../../shared/b640Offers';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const SUMMARY = '/api/v1/candidate/b640/responses/summary';
const NONE: ReadonlySet<string> = new Set();

/** B680: счётчики откликов, автоотклики отдельно. */
export async function getResponseSummary(signal?: AbortSignal): Promise<B640ResponseSummary> {
  return readDataObject<B640ResponseSummary>(await apiFetch(SUMMARY, { signal }));
}

/**
 * Id автооткликов для списка и воронки. Сводка — дополнение к списку: если она не пришла,
 * отклики показываются как раньше, просто без отметки «Авто».
 */
export function useAutoApplicationIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    const controller = new AbortController();
    getResponseSummary(controller.signal)
      .then((summary) => setIds(new Set(summary.autoApplicationIds)))
      .catch(() => setIds(NONE));
    return () => controller.abort();
  }, []);
  return ids;
}
