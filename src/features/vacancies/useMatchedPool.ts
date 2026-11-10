import { vacancySourceDisplayName } from '../../../shared/vacancySourceLabel';
import type { VacancySort } from '../../../shared/vacancySort';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import type { VacanciesScreenState } from './VacanciesScreenFilters';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getMatchedVacancyPage, getVacancySources } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { collectMatchedPool, withDeadline } from './vacancyRead';
import { readCachedMatchedPool, writeCachedMatchedPool, type CachedMatchedPool } from './matchedPoolCache';

export interface MatchedPool {
  readonly facets?: MatchedVacancyFacets;
  readonly initialFilters?: VacanciesScreenState;
  /** The sort the server applied to this selection (saved per account, 29.10). */
  readonly sort?: VacancySort;
  readonly setFilters?: (filters: VacanciesScreenState) => void;
  readonly matched: MatchedVacancyItem[];
  readonly total: number;
  readonly poolTotal: number;
  readonly loading: boolean;
  readonly failed: boolean;
  /** Прочитан ли пул целиком: выборка по половине пула — не выборка по пулу. */
  readonly complete: boolean;
  /** Кампания и гипотезы роли — только с первой страницы (B248). */
  readonly campaign?: CampaignMetaView;
  /** Целевой уровень кандидата, выведенный сервером — только с первой страницы. */
  readonly candidateLevel?: string | null;
  readonly failureSourceLabel?: string;
  readonly refresh?: () => void;
}

interface PoolReaderSetters {
  readonly setFacets: Dispatch<SetStateAction<MatchedVacancyFacets | undefined>>;
  readonly setInitialFilters: Dispatch<SetStateAction<VacanciesScreenState | undefined>>;
  readonly setSort: Dispatch<SetStateAction<VacancySort | undefined>>;
  readonly setMatched: Dispatch<SetStateAction<MatchedVacancyItem[]>>;
  readonly setTotal: Dispatch<SetStateAction<number>>;
  readonly setPoolTotal: Dispatch<SetStateAction<number>>;
  readonly setLoading: Dispatch<SetStateAction<boolean>>;
  readonly setFailed: Dispatch<SetStateAction<boolean>>;
  readonly setComplete: Dispatch<SetStateAction<boolean>>;
  readonly setCampaign: Dispatch<SetStateAction<CampaignMetaView | undefined>>;
  readonly setCandidateLevel: Dispatch<SetStateAction<string | null | undefined>>;
  readonly setFailureSourceLabel: Dispatch<SetStateAction<string | undefined>>;
}

/** One cabin-wide read; the owner screen can retry the bounded page sequence. */
export function useMatchedPool(provided?: MatchedPool): MatchedPool {
  // B589: the last unfiltered selection renders at once on a repeat visit.
  const [cached] = useState(() => (provided ? undefined : readCachedMatchedPool()));
  const [facets, setFacets] = useState<MatchedVacancyFacets | undefined>(cached?.facets);
  const [initialFilters, setInitialFilters] = useState<VacanciesScreenState | undefined>(
    cached?.initialFilters,
  );
  const [sort, setSort] = useState<VacancySort | undefined>(cached?.sort);
  const [filters, setFilterState] = useState<VacanciesScreenState>();
  const setFilters = useCallback((value: VacanciesScreenState) => {
    const hasServerFilters = hasMatchedPoolFilters(value);
    setFilterState((previous) =>
      hasServerFilters || hasMatchedPoolFilters(previous) ? value : undefined,
    );
  }, []);
  const initialPool = filters ? undefined : provided;
  const [matched, setMatched] = useState<MatchedVacancyItem[]>(cached?.matched ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [poolTotal, setPoolTotal] = useState(cached?.poolTotal ?? 0);
  const [loading, setLoading] = useState(!cached);
  const [failed, setFailed] = useState(false);
  const [complete, setComplete] = useState(cached?.complete ?? false);
  const [campaign, setCampaign] = useState<CampaignMetaView | undefined>(cached?.campaign);
  const [candidateLevel, setCandidateLevel] = useState<string | null | undefined>(
    cached?.candidateLevel,
  );
  const [failureSourceLabel, setFailureSourceLabel] = useState<string>();
  const [readAttempt, setReadAttempt] = useState(0);
  const refresh = useCallback(() => setReadAttempt((attempt) => attempt + 1), []);

  // Only the first read over a cached selection refreshes silently; a retry or
  // a filter change shows its own loading as before.
  const silentRead = useRef(Boolean(cached));
  useMatchedPoolReader(initialPool, readAttempt, filters, silentRead, {
    setFacets, setInitialFilters, setSort, setMatched, setTotal, setPoolTotal, setLoading, setFailed, setComplete,
    setCampaign, setCandidateLevel, setFailureSourceLabel,
  });
  useEffect(() => {
    if (provided || filters || loading || failed || matched.length === 0) return;
    const snapshot: CachedMatchedPool = {
      facets, initialFilters, sort, matched, total, poolTotal, complete, campaign, candidateLevel,
    };
    writeCachedMatchedPool(snapshot);
  }, [
    provided, filters, loading, failed, facets, initialFilters, sort, matched, total, poolTotal,
    complete, campaign, candidateLevel,
  ]);
  if (initialPool) return { ...initialPool, setFilters };
  return withCabinetHeader({
    facets, initialFilters, sort, setFilters, matched, total, poolTotal, loading, failed, complete,
    campaign, candidateLevel, failureSourceLabel, refresh,
  }, provided);
}

/**
 * Своё чтение ещё без первой страницы: шапка остаётся общей подборкой кабинета,
 * а не «0 вакансий, каталог неизвестен» на время пересортировки (29.10).
 */
function withCabinetHeader(local: MatchedPool, provided: MatchedPool | undefined): MatchedPool {
  if (local.facets || !provided) return local;
  return {
    ...local,
    facets: provided.facets,
    total: local.total || provided.total,
    poolTotal: local.poolTotal || provided.poolTotal,
    campaign: local.campaign ?? provided.campaign,
    candidateLevel:
      local.candidateLevel === undefined ? provided.candidateLevel : local.candidateLevel,
  };
}

function hasMatchedPoolFilters(filters: VacanciesScreenState | undefined): boolean {
  return Boolean(
    filters &&
      (filters.sort !== undefined ||
        filters.roles.length > 0 ||
        filters.regions.length > 0 ||
        (filters.levels?.length ?? 0) > 0 ||
        (filters.sources?.length ?? 0) > 0 ||
        (filters.selectedLocations?.length ?? 0) > 0 ||
        filters.locationRemote ||
        filters.remoteOnly),
  );
}

function useMatchedPoolReader(
  provided: MatchedPool | undefined,
  readAttempt: number,
  filters: VacanciesScreenState | undefined,
  silentRead: { current: boolean },
  setters: PoolReaderSetters,
): void {
  const {
    setMatched,
    setInitialFilters,
    setSort,
    setTotal,
    setPoolTotal,
    setLoading,
    setFailed,
    setComplete,
    setCampaign,
    setCandidateLevel,
    setFailureSourceLabel,
  } = setters;
  useEffect(() => {
    if (provided) return;
    return startPoolRead(setters, filters, readAttempt, silentRead);
  }, [
    provided,
    readAttempt,
    filters,
    setMatched,
    setInitialFilters,
    setSort,
    setTotal,
    setPoolTotal,
    setLoading,
    setFailed,
    setComplete,
    setCampaign,
    setCandidateLevel,
    setFailureSourceLabel,
    silentRead,
  ]);
}

/** One reader run; the returned cleanup ends it when the inputs change. */
function startPoolRead(
  setters: PoolReaderSetters,
  filters: VacanciesScreenState | undefined,
  readAttempt: number,
  silentRead: { current: boolean },
): () => void {
  let active = true;
  const silent = silentRead.current && !filters && readAttempt === 0;
  silentRead.current = false;
  let finished = false;
  if (!silent) resetPoolRead(setters);
  void loadMatchedPool(setters, () => active, filters, silent).finally(() => {
    finished = true;
    if (active) setters.setLoading(false);
  });
  return () => {
    active = false;
    // A dev double-run or an interrupted refresh still owes the cached list
    // its silent read.
    if (silent && !finished) silentRead.current = true;
  };
}

function resetPoolRead(setters: PoolReaderSetters): void {
  // Счётчики, кампания и уровень — прежние до ответа: меняется только список (29.10).
  setters.setMatched([]);
  setters.setLoading(true);
  setters.setFailed(false);
  setters.setComplete(false);
  setters.setFailureSourceLabel(undefined);
}

async function loadMatchedPool(
  setters: PoolReaderSetters,
  isActive: () => boolean,
  filters?: VacanciesScreenState,
  silent = false,
): Promise<void> {
  // A silent refresh replaces the cached list in one step when the read is
  // done, so the table never shrinks to the first page and grows back (B589).
  let lastPoolSize = 0;
  try {
    const pool = await collectMatchedPool<MatchedVacancyItem>(
      (offset) =>
        withDeadline((signal) => getMatchedVacancyPage(offset, signal, filters)).then((page) => {
          if (offset === 0 && isActive()) {
            if (page.facets) setters.setFacets(page.facets);
            if (page.initialFilters) setters.setInitialFilters(page.initialFilters);
            if (page.sort) setters.setSort(page.sort);
            if (page.campaign) setters.setCampaign(page.campaign);
            if (page.candidateLevel !== undefined) setters.setCandidateLevel(page.candidateLevel);
          }
          return page;
        }),
      undefined,
      (items, poolSize) => {
        if (!isActive()) return;
        lastPoolSize = poolSize;
        if (silent) return;
        setters.setMatched((read) => [...read, ...items]);
        setters.setPoolTotal(poolSize);
        // B446-r: число выдачи — ответ сервера, а не число дочитанных строк.
        setters.setTotal(poolSize);
        setters.setLoading(false);
      },
    );
    if (!isActive()) return;
    if (silent) {
      setters.setMatched(pool.items);
      setters.setPoolTotal(lastPoolSize);
    }
    setters.setTotal(pool.total);
    setters.setComplete(pool.complete);
  } catch {
    // A failed background refresh keeps the selection already on screen.
    if (!isActive() || silent) return;
    setters.setFailed(true);
    setters.setLoading(false);
    void failureSourceLabel().then((label) => {
      if (isActive()) setters.setFailureSourceLabel(label);
    });
  }
}

async function failureSourceLabel(): Promise<string | undefined> {
  try {
    const sources = await getVacancySources();
    const unhealthy = sources.filter(
      (source) => source.health.status !== 'healthy' && source.health.status !== 'not_checked',
    );
    return unhealthy.slice(0, 3).map(sourceFailureContext).join(' ') || undefined;
  } catch {
    return undefined;
  }
}

function sourceFailureContext(
  source: Awaited<ReturnType<typeof getVacancySources>>[number],
): string {
  if (source.health.status === 'official_access_required') {
    return `Поиск ${vacancySourceDisplayName(source.name)} без официального доступа недоступен. Вакансии общего подбора могут поступать из разрешённого регулярного сбора.`;
  }
  if (source.health.status === 'degraded') {
    return `${vacancySourceDisplayName(source.name)}: источник отвечает с ошибками.`;
  }
  return `${vacancySourceDisplayName(source.name)}: источник сейчас не отвечает.`;
}
