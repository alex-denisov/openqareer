import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getMatchedVacancyPage, getVacancySources } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { collectMatchedPool, withDeadline } from './vacancyRead';

export interface MatchedPool {
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
  const [matched, setMatched] = useState<MatchedVacancyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [poolTotal, setPoolTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [complete, setComplete] = useState(false);
  const [campaign, setCampaign] = useState<CampaignMetaView>();
  const [candidateLevel, setCandidateLevel] = useState<string | null>();
  const [failureSourceLabel, setFailureSourceLabel] = useState<string>();
  const [readAttempt, setReadAttempt] = useState(0);
  const refresh = useCallback(() => setReadAttempt((attempt) => attempt + 1), []);

  useMatchedPoolReader(provided, readAttempt, {
    setMatched,
    setTotal,
    setPoolTotal,
    setLoading,
    setFailed,
    setComplete,
    setCampaign,
    setCandidateLevel,
    setFailureSourceLabel,
  });

  return provided ?? {
    matched,
    total,
    poolTotal,
    loading,
    failed,
    complete,
    campaign,
    candidateLevel,
    failureSourceLabel,
    refresh,
  };
}

function useMatchedPoolReader(
  provided: MatchedPool | undefined,
  readAttempt: number,
  setters: PoolReaderSetters,
): void {
  const {
    setMatched,
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
    let active = true;
    resetPoolRead(setters);
    void loadMatchedPool(setters, () => active).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [
    provided,
    readAttempt,
    setMatched,
    setTotal,
    setPoolTotal,
    setLoading,
    setFailed,
    setComplete,
    setCampaign,
    setCandidateLevel,
    setFailureSourceLabel,
  ]);
}

function resetPoolRead(setters: PoolReaderSetters): void {
  setters.setMatched([]);
  setters.setTotal(0);
  setters.setPoolTotal(0);
  setters.setLoading(true);
  setters.setFailed(false);
  setters.setComplete(false);
  setters.setCampaign(undefined);
  setters.setCandidateLevel(undefined);
  setters.setFailureSourceLabel(undefined);
}

async function loadMatchedPool(
  setters: PoolReaderSetters,
  isActive: () => boolean,
): Promise<void> {
  try {
    const pool = await collectMatchedPool<MatchedVacancyItem>(
      (offset) =>
        withDeadline((signal) => getMatchedVacancyPage(offset, signal)).then((page) => {
          if (offset === 0 && isActive()) {
            if (page.campaign) setters.setCampaign(page.campaign);
            if (page.candidateLevel !== undefined) setters.setCandidateLevel(page.candidateLevel);
          }
          return page;
        }),
      undefined,
      (items, poolSize) => {
        if (!isActive()) return;
        setters.setMatched((read) => [...read, ...items]);
        setters.setPoolTotal(poolSize);
        setters.setLoading(false);
      },
    );
    if (!isActive()) return;
    setters.setTotal(pool.complete ? pool.total : pool.items.length);
    setters.setComplete(pool.complete);
  } catch {
    if (!isActive()) return;
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
    const namedSources = unhealthy.length > 0 ? unhealthy : sources;
    return namedSources.slice(0, 3).map((source) => source.name).join(', ') || undefined;
  } catch {
    return undefined;
  }
}
