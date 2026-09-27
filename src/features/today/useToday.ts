import { useCallback, useEffect, useState } from 'react';
import { getTodaySnapshot, recordCandidateVisit, type TodaySnapshot } from './todayApi';
import { recordFollowUpSent } from '../applications/applicationsApi';

export interface TodayRead {
  readonly snapshot: TodaySnapshot | null;
  readonly loading: boolean;
  /** Маршрут не ответил — не «данных нет», а поломка (B148 §5). */
  readonly failed: boolean;
  refresh(): Promise<void>;
  markFollowUpSent(applicationId: string): Promise<void>;
}

/**
 * «Сегодня» (B251 S5, architecture.md §57): сначала отмечает заход
 * (`POST /visits`), затем читает снимок дня своим часовым поясом — сервер
 * умеет только по календарным суткам, а где физически кандидат, знает
 * только браузер (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 */
export function useToday(): TodayRead {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    try {
      await recordCandidateVisit();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const read = await getTodaySnapshot(tz);
      if (!signal?.aborted) setSnapshot(read);
    } catch {
      if (!signal?.aborted) setFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const markFollowUpSent = useCallback(async (applicationId: string) => {
    await recordFollowUpSent(applicationId);
    await load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { snapshot, loading, failed, refresh: () => load(), markFollowUpSent };
}
