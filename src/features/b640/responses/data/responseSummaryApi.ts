import { useEffect, useState } from 'react';
import type { B640ResponseSummary } from '../../../../../shared/b640Offers';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const SUMMARY = '/api/v1/candidate/b640/responses/summary';
const NONE: ReadonlySet<string> = new Set();

/** B680: счётчики откликов, автоотклики отдельно. */
export async function getResponseSummary(signal?: AbortSignal): Promise<B640ResponseSummary> {
  return readDataObject<B640ResponseSummary>(await apiFetch(SUMMARY, { signal }));
}

export interface ResponseMarks {
  readonly auto: ReadonlySet<string>;
  /** Черновики с одобренным письмом (B645). */
  readonly approvedLetters: ReadonlySet<string>;
}

const NO_MARKS: ResponseMarks = { auto: NONE, approvedLetters: NONE };

/**
 * Отметки строк для списка и воронки: автоотклики и одобренные письма. Сводка — дополнение
 * к списку: если она не пришла, отклики показываются как раньше, без отметок.
 */
export function useResponseMarks(): ResponseMarks {
  const [marks, setMarks] = useState<ResponseMarks>(NO_MARKS);
  useEffect(() => {
    const controller = new AbortController();
    getResponseSummary(controller.signal)
      .then((summary) =>
        setMarks({
          auto: new Set(summary.autoApplicationIds),
          approvedLetters: new Set(summary.approvedLetterIds ?? []),
        }),
      )
      .catch(() => setMarks(NO_MARKS));
    return () => controller.abort();
  }, []);
  return marks;
}

/** Id автооткликов (воронка). */
export function useAutoApplicationIds(): ReadonlySet<string> {
  return useResponseMarks().auto;
}
