import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { getTodaySnapshot, recordCandidateVisit, type TodaySnapshot } from './todayApi';
import { recordFollowUpSent } from '../applications/applicationsApi';

export interface TodayRead {
  readonly snapshot: TodaySnapshot | null;
  readonly loading: boolean;
  /** Маршрут не ответил — не «данных нет», а поломка (B148 §5). */
  readonly failed: boolean;
  readonly markingFollowUpIds: ReadonlySet<string>;
  refresh(): Promise<void>;
  markFollowUpSent(applicationId: string): Promise<void>;
}

interface TodayLoadState {
  readonly requestId: number;
  readonly requestSequence: MutableRefObject<number>;
  readonly hasSnapshot: MutableRefObject<boolean>;
  readonly setSnapshot: Dispatch<SetStateAction<TodaySnapshot | null>>;
  readonly setLoading: Dispatch<SetStateAction<boolean>>;
  readonly setFailed: Dispatch<SetStateAction<boolean>>;
}

async function loadTodaySnapshot(
  { requestId, requestSequence, hasSnapshot, setSnapshot, setLoading, setFailed }: TodayLoadState,
  signal?: AbortSignal,
  recordVisit = false,
): Promise<void> {
  setLoading(true);
  setFailed(false);
  try {
    if (recordVisit) await recordCandidateVisit(signal);
    if (signal?.aborted || requestId !== requestSequence.current) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const snapshot = await getTodaySnapshot(timezone, signal);
    if (!signal?.aborted && requestId === requestSequence.current) {
      hasSnapshot.current = true;
      setSnapshot(snapshot);
    }
  } catch {
    if (!signal?.aborted && requestId === requestSequence.current && !hasSnapshot.current) {
      setFailed(true);
    }
  } finally {
    if (!signal?.aborted && requestId === requestSequence.current) setLoading(false);
  }
}

export function useToday(): TodayRead {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [markingFollowUpIds, setMarkingFollowUpIds] = useState<ReadonlySet<string>>(() => new Set());
  const requestSequence = useRef(0);
  const hasSnapshot = useRef(false);
  const markingIds = useRef(new Set<string>());

  const load = useCallback(async (signal?: AbortSignal, recordVisit = false) => {
    const requestId = ++requestSequence.current;
    await loadTodaySnapshot(
      { requestId, requestSequence, hasSnapshot, setSnapshot, setLoading, setFailed },
      signal,
      recordVisit,
    );
  }, []);

  const markFollowUpSent = useCallback(async (applicationId: string) => {
    if (markingIds.current.has(applicationId)) return;
    const nextIds = new Set(markingIds.current).add(applicationId);
    markingIds.current = nextIds;
    setMarkingFollowUpIds(nextIds);
    try {
      await recordFollowUpSent(applicationId);
      await load();
    } finally {
      const remainingIds = new Set(markingIds.current);
      remainingIds.delete(applicationId);
      markingIds.current = remainingIds;
      setMarkingFollowUpIds(remainingIds);
    }
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, true);
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [load]);

  return { snapshot, loading, failed, markingFollowUpIds, refresh: () => load(), markFollowUpSent };
}
