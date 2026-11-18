import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  readonly nothing: number | null;
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
const NO_IDS: readonly string[] = [];

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
    if (item && reason && isKnownSkipReasonId(reason)) entries.push({ item, reason });
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
        .catch(() => entries.map((entry) => entry.item.cluster.id))
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

/**
 * Скрывать нечего и спрашивать не о чем: режим закрывается сам, на его месте остаётся итог
 * с числом разобранных вакансий.
 */
function useNothingResult(
  settled: VacancyTriage | null,
  close: () => void,
): { readonly nothing: number | null; readonly clearResult: () => void } {
  const [nothing, setNothing] = useState<number | null>(null);
  useEffect(() => {
    if (!settled || settled.summary.hide > 0 || settled.questions.length > 0) return;
    close();
    setNothing(settled.summary.total);
  }, [settled, close]);
  const clearResult = useCallback(() => setNothing(null), []);
  return useMemo(() => ({ nothing, clearResult }), [nothing, clearResult]);
}

/** Откуда режим знает, что подборка дочитана, и сколько в ней вакансий, пока она читается. */
export interface TriageSource {
  readonly ready: boolean;
  readonly expected: number;
}

const READY_NOW: TriageSource = { ready: true, expected: 0 };
/** Сколько ждать дочитывания подборки, прежде чем разобрать то, что уже прочитано. */
export const TRIAGE_POOL_WAIT_MS = 20_000;

interface TriageList {
  /** Список одного разбора; `null` — нажатие ждёт, пока подборка дочитается. */
  readonly ids: readonly string[] | null;
  readonly capture: () => void;
}

/**
 * Одно нажатие — один список: он берётся целиком, когда подборка дочитана, и после этого
 * не меняется. Дочитывание, сортировка и фильтры новый разбор не запускают.
 */
function useTriageList(
  active: boolean,
  items: readonly MatchedVacancyItem[],
  ready: boolean,
): TriageList {
  const [ids, setIds] = useState<readonly string[] | null>(null);
  const latest = useRef(items);
  latest.current = items;
  const waiting = active && ids === null;
  useEffect(() => {
    if (!waiting) return undefined;
    if (ready) {
      setIds(triageIds(latest.current));
      return undefined;
    }
    const timer = setTimeout(() => setIds(triageIds(latest.current)), TRIAGE_POOL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, ready]);
  const capture = useCallback(() => setIds(null), []);
  return { ids, capture };
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

/** Пока нажатие ждёт подборку, это тоже «разбираем», а число — из шапки списка. */
function progressOf(
  active: boolean,
  ids: readonly string[] | null,
  status: TriageStatus,
  expected: number,
): Pick<Triage, 'status' | 'total'> {
  if (ids === null) return { status: active ? 'loading' : status, total: expected };
  return { status, total: ids.length };
}

/** Режим «Помочь выбрать»: разбор всей подборки, флажки, вопросы по одному, скрытие серией. */
export function useTriage(
  items: readonly MatchedVacancyItem[],
  hideMany: HideMany,
  source: TriageSource = READY_NOW,
): Triage {
  const [active, setActive] = useState(false);
  const [answers, setAnswers] = useState<VacancyTriageAnswers>(NO_ANSWERS);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(NONE);
  const series = useHideSeries(hideMany);
  const { state: hide, reset: resetSeries } = series;
  const { ids, capture } = useTriageList(active, items, source.ready);
  const request = useTriageRequest(active && ids !== null, hide.status === 'busy', ids ?? NO_IDS, answers);
  const rows = useMemo(() => triageRowMap(request.triage), [request.triage]);
  const picked = useMemo(() => pickedIds(request.triage, unchecked), [request.triage, unchecked]);

  const cancel = useCallback(() => {
    setActive(false);
    setAnswers(NO_ANSWERS);
    setUnchecked(NONE);
    resetSeries();
  }, [resetSeries]);

  const result = useNothingResult(active && request.status === 'ready' ? request.triage : null, cancel);

  const start = useCallback(() => {
    result.clearResult();
    capture();
    setActive(true);
  }, [capture, result]);

  const hideSelected = useCallback(() => {
    if (picked.length === 0) return;
    const { entries, lost } = entriesFor(picked, rows, items);
    series.run(entries, lost.length, cancel);
  }, [picked, rows, items, series, cancel]);

  return {
    active,
    triage: request.triage,
    ...progressOf(active, ids, request.status, source.expected),
    ...result,
    question: currentQuestion(request.triage),
    picked: picked.length,
    weak: request.triage ? isWeakMatch(request.triage.summary) : false,
    hide,
    rowFor: (id) => (active ? rows.get(id) : undefined),
    isPicked: (id) => active && rows.get(id)?.verdict === 'hide' && !unchecked.has(id),
    toggle: (id) => setUnchecked((current) => toggleUnchecked(current, id)),
    answer: (value) => setAnswers((current) => withAnswer(current, request.triage, value)),
    start,
    cancel,
    retry: request.retry,
    hideSelected,
  };
}
