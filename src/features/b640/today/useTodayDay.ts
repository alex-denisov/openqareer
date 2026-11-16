import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  getTodayQueueRemainder,
  getTodaySnapshot,
  recordCandidateVisit,
  type TodaySnapshot,
} from '../../today/todayApi';

/**
 * День кандидата для нового «Сегодня». Первый ответ `/candidate/today` на
 * проде бывает дольше срока ожидания клиента (20 с), поэтому чтение само
 * повторяется, а ошибка показывается только после трёх сбоев подряд.
 * Причину сбоя пишем в консоль: молчаливый сбой на проде не разобрать.
 */
export interface TodayDay {
  readonly snapshot: TodaySnapshot | null;
  /** Прочитать день не удалось: блок показывает ошибку и «Повторить». */
  readonly failed: boolean;
  readonly queueRemainderLoading: boolean;
  readonly queueRemainderFailed: boolean;
  refresh(): Promise<void>;
  loadQueueRemainder(): Promise<void>;
}

const READ_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 1_000;

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function report(what: string, reason: unknown): void {
  // eslint-disable-next-line no-console -- причина сбоя нужна при разборе на проде
  console.error(`B640 «Сегодня»: ${what}`, reason);
}

/** Читает день; при сбое пробует ещё. Последнюю причину бросает вызывающему. */
async function readDay(signal: AbortSignal): Promise<TodaySnapshot> {
  let lastReason: unknown = null;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      return await getTodaySnapshot(timeZone(), signal);
    } catch (reason) {
      lastReason = reason;
      if (signal.aborted) break;
      if (attempt < READ_ATTEMPTS) await pause(RETRY_PAUSE_MS, signal);
    }
  }
  throw lastReason;
}

async function recordVisit(signal: AbortSignal): Promise<void> {
  try {
    await recordCandidateVisit(signal);
  } catch (reason) {
    // Отметка визита не должна прятать дела дня.
    if (!signal.aborted) report('не записали визит', reason);
  }
}

type SetSnapshot = Dispatch<SetStateAction<TodaySnapshot | null>>;

/** «Показать ещё» у очереди дня: следующая порция дописывается к показанной. */
function useQueueRemainder(
  snapshot: TodaySnapshot | null,
  setSnapshot: SetSnapshot,
  refresh: () => Promise<void>,
) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const revision = snapshot?.queueRevision;
    const offset = snapshot?.queue.length ?? 0;
    const total = snapshot?.queueTotal ?? offset;
    if (!snapshot || !revision || offset >= total || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await getTodayQueueRemainder(timeZone(), offset, revision);
      if (page.queueRevision !== revision || page.queueOffset !== offset) {
        await refresh();
        return;
      }
      setSnapshot((current) =>
        current?.queueRevision === revision && current.queue.length === offset
          ? { ...current, queue: [...current.queue, ...page.queue] }
          : current,
      );
    } catch (reason) {
      report('не догрузили остальные дела', reason);
      setFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [refresh, setSnapshot, snapshot]);
  return { loading, failed, load };
}

export function useTodayDay(): TodayDay {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const unmounted = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal, visit: boolean) => {
    setFailed(false);
    if (visit) await recordVisit(signal);
    if (signal.aborted) return;
    try {
      const next = await readDay(signal);
      if (!signal.aborted) setSnapshot(next);
    } catch (reason) {
      if (signal.aborted) return;
      report('не прочитали дела дня', reason);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    void load(controller.signal, true);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    if (unmounted.current) await load(unmounted.current.signal, false);
  }, [load]);
  const more = useQueueRemainder(snapshot, setSnapshot, refresh);

  return {
    snapshot,
    failed,
    queueRemainderLoading: more.loading,
    queueRemainderFailed: more.failed,
    refresh,
    loadQueueRemainder: more.load,
  };
}
