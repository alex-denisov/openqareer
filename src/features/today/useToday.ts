import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  TODAY_DECISION_CHANGED,
  getTodayQueueRemainder,
  getTodaySnapshot,
  recordCandidateVisit,
  type TodaySnapshot,
} from './todayApi';
import { recordFollowUpSent } from '../applications/applicationsApi';
import { CoachApiError } from '../coach/apiClient';

export interface TodayRead {
  readonly snapshot: TodaySnapshot | null;
  readonly loading: boolean;
  /** Маршрут не ответил — не «данных нет», а поломка (B148 §5). */
  readonly failed: boolean;
  readonly markingFollowUpIds: ReadonlySet<string>;
  readonly queueRemainderLoading: boolean;
  readonly queueRemainderFailed: boolean;
  refresh(): Promise<void>;
  loadQueueRemainder(): Promise<void>;
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
  const requestSequence = useRef(0);
  const hasSnapshot = useRef(false);
  const load = useCallback(async (signal?: AbortSignal, recordVisit = false) => {
    const requestId = ++requestSequence.current;
    await loadTodaySnapshot(
      { requestId, requestSequence, hasSnapshot, setSnapshot, setLoading, setFailed },
      signal,
      recordVisit,
    );
  }, []);
  const queue = useTodayQueueRemainder(snapshot, setSnapshot, load);
  const followUps = useTodayFollowUpMarker(load);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, true);
    const refreshDecision = () => void load(controller.signal);
    window.addEventListener(TODAY_DECISION_CHANGED, refreshDecision);
    return () => {
      window.removeEventListener(TODAY_DECISION_CHANGED, refreshDecision);
      controller.abort();
      requestSequence.current += 1;
    };
  }, [load]);

  return {
    snapshot,
    loading,
    failed,
    markingFollowUpIds: followUps.markingFollowUpIds,
    queueRemainderLoading: queue.loading,
    queueRemainderFailed: queue.failed,
    refresh: () => load(),
    loadQueueRemainder: queue.load,
    markFollowUpSent: followUps.mark,
  };
}

function useTodayQueueRemainder(
  snapshot: TodaySnapshot | null,
  setSnapshot: Dispatch<SetStateAction<TodaySnapshot | null>>,
  reload: () => Promise<void>,
) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const queueTotal = snapshot?.queueTotal ?? snapshot?.queue.length ?? 0;
    const revision = snapshot?.queueRevision;
    const offset = snapshot?.queue.length ?? 0;
    if (!snapshot || !revision || offset >= queueTotal || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const page = await getTodayQueueRemainder(timeZone, offset, revision);
      if (page.queueRevision !== revision || page.queueOffset !== offset) {
        await reload();
        return;
      }
      setSnapshot((current) =>
        current?.queueRevision === revision && current.queue.length === offset
          ? { ...current, queue: [...current.queue, ...page.queue] }
          : current,
      );
    } catch (error) {
      if (error instanceof CoachApiError && error.code === 'today_queue_changed') {
        await reload();
      } else {
        setFailed(true);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [reload, setSnapshot, snapshot]);
  return { loading, failed, load };
}

function useTodayFollowUpMarker(load: () => Promise<void>) {
  const [markingFollowUpIds, setMarkingFollowUpIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markingIds = useRef(new Set<string>());
  const mark = useCallback(
    async (applicationId: string) => {
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
    },
    [load],
  );
  return { markingFollowUpIds, mark };
}
