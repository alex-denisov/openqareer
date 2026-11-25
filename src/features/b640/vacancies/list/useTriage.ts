import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VacancyTriage, VacancyTriageAnswers, VacancyTriageRow } from '../../../../../shared/b640Vacancies';
import { isKnownSkipReasonId } from '../../../../../shared/skipReasons';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import {
  currentQuestion,
  isWeakMatch,
  pickedIds,
  toggleUnchecked,
  triageIds,
  triageRowMap,
  type CurrentQuestion,
  type HideEntry,
} from './triageModel';
import type { TriageTarget } from '../triageApi';
import { useTriageRequest, type TriageStatus } from './useTriageRequest';

/** Скрывает вакансии с причинами; возвращает id, которые скрыть не удалось. */
export type HideMany = (entries: readonly HideEntry[]) => Promise<readonly string[]>;

export interface HideState {
  readonly status: 'idle' | 'busy' | 'failed';
  readonly failed: number;
}

export interface Triage {
  readonly active: boolean;
  readonly status: TriageStatus;
  readonly triage: VacancyTriage | null;
  /** Сколько вакансий уходит на разбор. */
  readonly total: number;
  /** Итог «скрывать нечего»: сколько вакансий разобрано; `null` — итога нет. */
  readonly nothing: NothingResult | null;
  readonly clearResult: () => void;
  readonly question: CurrentQuestion | null;
  readonly picked: number;
  readonly weak: boolean;
  readonly hide: HideState;
  readonly rowFor: (id: string) => VacancyTriageRow | undefined;
  readonly isPicked: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly answer: (value: boolean) => void;
  readonly start: () => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly hideSelected: () => void;
}

const NO_HIDE: HideState = { status: 'idle', failed: 0 };
const NO_ANSWERS: VacancyTriageAnswers = {};
const NONE: ReadonlySet<string> = new Set();

function entriesFor(
  ids: readonly string[],
  rows: ReadonlyMap<string, VacancyTriageRow>,
  items: readonly MatchedVacancyItem[],
): { readonly entries: HideEntry[]; readonly lost: string[] } {
  const byId = new Map(items.map((item) => [item.cluster.id, item]));
  const entries: HideEntry[] = [];
  const lost: string[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    const reason = rows.get(id)?.reasonId;
    // Строки может ещё не быть на клиенте: скрытию хватает id и причины.
    if (reason && isKnownSkipReasonId(reason)) entries.push({ id, reason, ...(item ? { item } : {}) });
    else lost.push(id);
  }
  return { entries, lost };
}

interface HideSeries {
  readonly state: HideState;
  /** Скрывает серией; всё скрыто — зовёт `onDone`, иначе оставляет число нескрытых. */
  readonly run: (entries: readonly HideEntry[], lost: number, onDone: () => void) => void;
  readonly reset: () => void;
}

function useHideSeries(hideMany: HideMany): HideSeries {
  const [state, setState] = useState<HideState>(NO_HIDE);
  const run = useCallback(
    (entries: readonly HideEntry[], lost: number, onDone: () => void) => {
      setState({ status: 'busy', failed: 0 });
      hideMany(entries)
        .catch(() => entries.map((entry) => entry.id))
        .then((failed) => {
          const left = failed.length + lost;
          if (left === 0) onDone();
          else setState({ status: 'failed', failed: left });
        });
    },
    [hideMany],
  );
  const reset = useCallback(() => setState(NO_HIDE), []);
  return useMemo(() => ({ state, run, reset }), [state, run, reset]);
}

/** Итог «скрывать нечего»: сколько разобрано и, если подборка больше потолка разбора, её размер. */
export interface NothingResult {
  readonly total: number;
  readonly pool?: number;
}

/** Скрывать нечего и спрашивать не о чем: режим закрывается сам, на его месте остаётся итог. */
function useNothingResult(
  settled: VacancyTriage | null,
  close: () => void,
): { readonly nothing: NothingResult | null; readonly clearResult: () => void } {
  const [nothing, setNothing] = useState<NothingResult | null>(null);
  useEffect(() => {
    if (!settled || settled.summary.hide > 0 || settled.questions.length > 0) return;
    close();
    const { total } = settled.summary;
    const pool = settled.poolTotal;
    setNothing(pool !== undefined && pool > total ? { total, pool } : { total });
  }, [settled, close]);
  const clearResult = useCallback(() => setNothing(null), []);
  return useMemo(() => ({ nothing, clearResult }), [nothing, clearResult]);
}

/**
 * Что разбирать по нажатию: `query` — вся подборка по этим фильтрам списка (сервер берёт её сам);
 * `null` — только показанные строки (у списка есть фильтры, которых сервер не знает).
 */
export interface TriageSource {
  readonly query: string | null;
  /** Число вакансий из шапки списка: показывается, пока разбор идёт. */
  readonly expected: number;
  /** `false`: список ещё ставит свои роли; нажатие дождётся их, чтобы разобрать ту же выборку. */
  readonly ready?: boolean;
}

const SHOWN_ROWS: TriageSource = { query: null, expected: 0 };

interface TriageTargetState {
  readonly target: TriageTarget | null;
  readonly capture: () => void;
}

/** Одно нажатие — одна цель разбора: дочитывание, сортировка и фильтры её потом не меняют. */
function useTriageTarget(
  items: readonly MatchedVacancyItem[],
  query: string | null,
): TriageTargetState {
  const [target, setTarget] = useState<TriageTarget | null>(null);
  const capture = useCallback(
    () => setTarget(query === null ? { clusterIds: triageIds(items) } : { query }),
    [items, query],
  );
  return { target, capture };
}

/** Ответ на текущий вопрос; вопроса нет — ответы прежние. */
function withAnswer(
  answers: VacancyTriageAnswers,
  triage: VacancyTriage | null,
  value: boolean,
): VacancyTriageAnswers {
  const id = currentQuestion(triage)?.id;
  return id ? { ...answers, [id]: value } : answers;
}

/** Пока разбор идёт, число — из шапки списка; после — сколько вакансий разобрано на самом деле. */
function progressOf(
  status: TriageStatus,
  triage: VacancyTriage | null,
  target: TriageTarget | null,
  expected: number,
): Pick<Triage, 'status' | 'total'> {
  if (status === 'ready' && triage) return { status, total: triage.summary.total };
  const shown = target && 'clusterIds' in target ? target.clusterIds.length : expected;
  return { status, total: shown };
}

function rowView(
  active: boolean,
  rows: ReadonlyMap<string, VacancyTriageRow>,
  unchecked: ReadonlySet<string>,
): Pick<Triage, 'rowFor' | 'isPicked'> {
  return {
    rowFor: (id) => (active ? rows.get(id) : undefined),
    isPicked: (id) => active && rows.get(id)?.verdict === 'hide' && !unchecked.has(id),
  };
}

/** Нажатие: сразу или когда список поставит свои роли. */
function useStart(
  ready: boolean,
  waiting: boolean,
  setWaiting: (value: boolean) => void,
  begin: () => void,
): () => void {
  useEffect(() => {
    if (!waiting || !ready) return;
    setWaiting(false);
    begin();
  }, [waiting, ready, setWaiting, begin]);
  return useCallback(() => (ready ? begin() : setWaiting(true)), [ready, begin, setWaiting]);
}

/** Режим «Помочь выбрать»: разбор всей подборки, флажки, вопросы по одному, скрытие серией. */
export function useTriage(
  items: readonly MatchedVacancyItem[],
  hideMany: HideMany,
  source: TriageSource = SHOWN_ROWS,
): Triage {
  const [active, setActive] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [answers, setAnswers] = useState<VacancyTriageAnswers>(NO_ANSWERS);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(NONE);
  const { state: hide, reset: resetSeries, run: runSeries } = useHideSeries(hideMany);
  const { target, capture } = useTriageTarget(items, source.query);
  const request = useTriageRequest(active, hide.status === 'busy', target, answers);
  const rows = useMemo(() => triageRowMap(request.triage), [request.triage]);
  const picked = useMemo(() => pickedIds(request.triage, unchecked), [request.triage, unchecked]);

  const cancel = useCallback(() => {
    setActive(false);
    setWaiting(false);
    setAnswers(NO_ANSWERS);
    setUnchecked(NONE);
    resetSeries();
  }, [resetSeries]);

  const result = useNothingResult(active && request.status === 'ready' ? request.triage : null, cancel);

  const begin = useCallback(() => {
    result.clearResult();
    capture();
    setActive(true);
  }, [capture, result]);
  const start = useStart(source.ready !== false, waiting, setWaiting, begin);

  const hideSelected = useCallback(() => {
    const { entries, lost } = entriesFor(picked, rows, items);
    if (picked.length > 0) runSeries(entries, lost.length, cancel);
  }, [picked, rows, items, runSeries, cancel]);

  return {
    active: active || waiting,
    triage: request.triage,
    ...progressOf(waiting ? 'loading' : request.status, request.triage, waiting ? null : target, source.expected),
    ...result,
    question: currentQuestion(request.triage),
    picked: picked.length,
    weak: request.triage ? isWeakMatch(request.triage.summary) : false,
    hide,
    ...rowView(active, rows, unchecked),
    toggle: (id) => setUnchecked((current) => toggleUnchecked(current, id)),
    answer: (value) => setAnswers((current) => withAnswer(current, request.triage, value)),
    start,
    cancel,
    retry: request.retry,
    hideSelected,
  };
}
