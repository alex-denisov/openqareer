/**
 * B550: состояние сохранённых вакансий для вкладки «Сохранённые» — деньги,
 * закрытие на площадке (B200), уровень и гео с совпадением по тем же правилам,
 * что подборка. Сохранённая сопоставляется с текущим кластером каталога по id,
 * иначе по URL (ключ участника кластера). Каждая читается по одному
 * индексированному ключу, без подъёма всех кластеров (PRB-041).
 */
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import {
  evaluateLevelMatch,
  inferSeniorityLevel,
  levelFromRank,
  type SeniorityLevel,
} from './levelMatcher';
import { normalizeTitleKey } from './titleParse/normalizeTitleKey';
import { isOutsideGeography } from './vacancyGeography';
import type { MarketSalaryEstimateView } from '../../shared/marketSalaryEstimate';

interface ClusterLike {
  readonly status: 'active' | 'archived';
  readonly canonicalTitle: string;
  readonly canonicalLocation?: string;
  readonly isRemote: boolean;
  readonly companyFeatures?: { readonly country?: string };
  readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
  readonly deadLink?: boolean;
  readonly linkStatus?: 'open' | 'gone' | 'unknown';
  readonly sources?: readonly { readonly sourceName?: string; readonly observedAt?: string }[];
  readonly firstObservedAt?: string;
}

export interface SavedVacancyStateSource {
  getActiveCluster(clusterId: string): ClusterLike | undefined;
  getActiveClusterByMemberKey(key: string): ClusterLike | undefined;
  isKnownVacancyGone(clusterId: string): boolean;
  getVacancy(id: string): { readonly archivedAt?: string } | undefined;
}

export interface SavedVacancyMatchContext {
  readonly candidateLevel: SeniorityLevel | undefined;
  readonly regions: readonly CandidateRegion[];
  readonly getTitleParse: (titleKey: string) => { readonly levelRank: number | null } | undefined;
  /** B446-r: оценка рынка для вакансии без зарплаты — та же, что в подборке (B546). */
  readonly marketSalary?: (cluster: ClusterLike) => MarketSalaryEstimateView | undefined;
}

export interface SavedVacancyRef {
  readonly clusterId: string;
  readonly url?: string;
}

export interface SavedVacancyStateView {
  readonly closed: boolean;
  /** `false` — вакансии нет в текущем каталоге: уровень и гео неизвестны. */
  readonly inCatalog: boolean;
  readonly closedAt?: string;
  readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
  readonly vacancyLevel?: SeniorityLevel;
  readonly levelMatch?: 'match' | 'above' | 'below' | 'unknown';
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly outsideGeography?: boolean;
  /** B446-r: подпись денег как в подборке — «указана в вакансии · hh.ru, 05.10». */
  readonly sourceName?: string;
  readonly observedAt?: string;
  readonly marketSalary?: MarketSalaryEstimateView;
}

export const SAVED_VACANCY_STATES_LIMIT = 100;

/** Тот же URL с хвостом «/», без якоря — варианты ключа, как его записала площадка. */
function urlKeys(url: string | undefined): string[] {
  const value = url?.trim();
  if (!value) return [];
  const withoutHash = value.split('#')[0] ?? value;
  const trimmed = withoutHash.replace(/\/+$/u, '');
  return [...new Set([value, withoutHash, trimmed, `${trimmed}/`])];
}

function findCluster(
  source: SavedVacancyStateSource,
  ref: SavedVacancyRef,
): ClusterLike | undefined {
  const byId = source.getActiveCluster(ref.clusterId);
  if (byId) return byId;
  for (const key of urlKeys(ref.url)) {
    const byUrl = source.getActiveClusterByMemberKey(key);
    if (byUrl) return byUrl;
  }
  return undefined;
}

function catalogState(
  cluster: ClusterLike,
  context: SavedVacancyMatchContext,
): SavedVacancyStateView {
  const parsed = context.getTitleParse(normalizeTitleKey(cluster.canonicalTitle));
  const vacancyLevel =
    parsed === undefined
      ? inferSeniorityLevel(cluster.canonicalTitle)
      : levelFromRank(parsed.levelRank);
  const source = cluster.sources?.[0];
  const observedAt = source?.observedAt ?? cluster.firstObservedAt;
  const salaryKnown = Boolean(cluster.salary?.from ?? cluster.salary?.to);
  const marketSalary = salaryKnown ? undefined : context.marketSalary?.(cluster);
  return {
    closed: Boolean(cluster.deadLink || cluster.linkStatus === 'gone'),
    inCatalog: true,
    ...(cluster.salary ? { salary: cluster.salary } : {}),
    ...(source?.sourceName ? { sourceName: source.sourceName } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(marketSalary ? { marketSalary } : {}),
    ...(vacancyLevel ? { vacancyLevel } : {}),
    levelMatch: evaluateLevelMatch(
      context.candidateLevel,
      cluster.canonicalTitle,
      parsed?.levelRank,
    ),
    ...(cluster.canonicalLocation ? { location: cluster.canonicalLocation } : {}),
    isRemote: cluster.isRemote,
    outsideGeography: isOutsideGeography(cluster, context.regions),
  };
}

function goneState(source: SavedVacancyStateSource, clusterId: string): SavedVacancyStateView {
  if (!source.isKnownVacancyGone(clusterId)) return { closed: false, inCatalog: false };
  const memberId = clusterId.startsWith('cluster-')
    ? clusterId.slice('cluster-'.length)
    : clusterId;
  const closedAt = memberId ? source.getVacancy(memberId)?.archivedAt : undefined;
  return closedAt
    ? { closed: true, inCatalog: false, closedAt }
    : { closed: true, inCatalog: false };
}

export function savedVacancyStates(
  source: SavedVacancyStateSource,
  refs: readonly SavedVacancyRef[],
  context: SavedVacancyMatchContext,
): Record<string, SavedVacancyStateView> {
  const unique = [...new Map(refs.map((ref) => [ref.clusterId, ref])).values()];
  const entries = unique.slice(0, SAVED_VACANCY_STATES_LIMIT).map((ref) => {
    const cluster = findCluster(source, ref);
    return [
      ref.clusterId,
      cluster ? catalogState(cluster, context) : goneState(source, ref.clusterId),
    ] as const;
  });
  return Object.fromEntries(entries);
}
