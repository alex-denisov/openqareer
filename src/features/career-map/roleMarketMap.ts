import type {
  EvidenceItem,
  RoleFitState,
  RoleHypothesis,
} from '../evidence/evidenceEngine';

const ROLE_MARKET_MAP_REVISION = 'role-market-map-v1-2026-08-07' as const;

type MarketGeography =
  | 'russia'
  | 'relocation'
  | 'worldwide-remote';
type WorkMode = 'onsite' | 'hybrid' | 'remote';
type MarketSampleStatus = 'fresh' | 'stale' | 'insufficient';

interface MarketObservation {
  id: string;
  roleTitle: string;
  observedAt: string;
  sourceLabel: string;
  requirements: string[];
}

interface RequestedMarket {
  id: string;
  geography: MarketGeography;
  label: string;
  countryCode?: string;
  workMode: WorkMode;
  observations: MarketObservation[];
}

export interface RoleMarketMapInput {
  roleHypotheses: RoleHypothesis[];
  evidence: EvidenceItem[];
  markets: RequestedMarket[];
}

interface MappedRole {
  id: string;
  title: string;
  level: 'executive' | 'lead' | 'senior' | 'manager' | 'unknown';
  fitState: RoleFitState;
  basis: string;
  evidenceRefs: string[];
  gaps: string[];
  nextExperiment: string;
}

interface MappedMarket {
  id: string;
  geography: MarketGeography;
  label: string;
  countryCode?: string;
  workMode: WorkMode;
  sampleStatus: MarketSampleStatus;
  certainty: 'fact' | 'unknown';
  sampleSize: number;
  lastObservedAt: string | null;
  repeatedRequirements: string[];
  gaps: string[];
}

export interface RoleMarketMap {
  revision: typeof ROLE_MARKET_MAP_REVISION;
  generatedAt: string;
  roles: MappedRole[];
  markets: MappedMarket[];
  nextExperiment: {
    label: string;
    reason: string;
    roleIds: string[];
    marketIds: string[];
  };
}

export function buildRoleMarketMap(
  input: RoleMarketMapInput,
  now: string = new Date().toISOString(),
): RoleMarketMap {
  const confirmedIds = new Set(
    input.evidence
      .filter((item) => item.status === 'confirmed')
      .map((item) => item.id),
  );
  const roles = input.roleHypotheses.slice(0, 3).map((role) => ({
    id: role.id,
    title: role.title,
    level: inferLevel(role.title),
    fitState: role.fitState,
    basis: role.basis,
    evidenceRefs: role.evidenceIds
      .filter((id) => confirmedIds.has(id))
      .map((id) => `evidence:${id}`),
    gaps: role.gaps,
    nextExperiment:
      role.gaps[0] ??
      'Сравнить повторяющиеся задачи и уровень в свежей выборке вакансий.',
  }));
  const markets = input.markets.map((market) => mapMarket(market, now));
  const marketNeedingEvidence = markets.find(
    (market) => market.sampleStatus !== 'fresh',
  );
  const roleNeedingEvidence = roles.find(
    (role) => role.fitState !== 'plausible' || role.evidenceRefs.length === 0,
  );

  return {
    revision: ROLE_MARKET_MAP_REVISION,
    generatedAt: now,
    roles,
    markets,
    nextExperiment: marketNeedingEvidence
      ? {
          label: `Собрать свежую выборку: ${marketNeedingEvidence.label}`,
          reason:
            'Без свежей датированной выборки нельзя честно сравнить спрос, уровень роли и ограничения рынка.',
          roleIds: roles.map((role) => role.id),
          marketIds: [marketNeedingEvidence.id],
        }
      : roleNeedingEvidence
        ? {
            label: roleNeedingEvidence.nextExperiment,
            reason:
              'Эта проверка сильнее всего изменит сравнение карьерных гипотез.',
            roleIds: [roleNeedingEvidence.id],
            marketIds: markets.map((market) => market.id),
          }
        : {
            label: 'Выбрать рабочую роль и рынок для первой кампании',
            reason:
              'Роли подтверждены, а рыночные выборки достаточно свежие для обратимого решения.',
            roleIds: roles.map((role) => role.id),
            marketIds: markets.map((market) => market.id),
          },
  };
}

function mapMarket(market: RequestedMarket, now: string): MappedMarket {
  const validDates = market.observations
    .map((observation) => observation.observedAt)
    .filter((date) => !Number.isNaN(new Date(date).valueOf()))
    .sort();
  const lastObservedAt = validDates.at(-1) ?? null;
  const stale = lastObservedAt
    ? daysBetween(lastObservedAt, now) > 90
    : false;
  const sampleStatus: MarketSampleStatus = stale
    ? 'stale'
    : market.observations.length < 5
      ? 'insufficient'
      : 'fresh';
  const repeatedRequirements = repeatedValues(
    market.observations.flatMap((observation) => observation.requirements),
  );

  return {
    id: market.id,
    geography: market.geography,
    label: market.label,
    countryCode: market.countryCode,
    workMode: market.workMode,
    sampleStatus,
    certainty: sampleStatus === 'fresh' ? 'fact' : 'unknown',
    sampleSize: market.observations.length,
    lastObservedAt,
    repeatedRequirements,
    gaps: [
      ...(sampleStatus === 'stale'
        ? ['Последняя рыночная выборка старше 90 дней.']
        : []),
      ...(market.observations.length < 5
        ? ['Для сравнения нужно не менее 5 релевантных вакансий.']
        : []),
      ...(market.geography === 'relocation' && !market.countryCode
        ? ['Не выбрана страна для проверки права на работу и релокации.']
        : []),
    ],
  };
}

function inferLevel(title: string): MappedRole['level'] {
  if (/\b(c-level|chief|директор|vp|вице-президент|coo|cto|cpo)\b/iu.test(title)) {
    return 'executive';
  }
  if (/\b(head|lead|руководител)\b/iu.test(title)) return 'lead';
  if (/\b(senior|старш)\b/iu.test(title)) return 'senior';
  if (/\b(manager|менеджер)\b/iu.test(title)) return 'manager';
  return 'unknown';
}

function repeatedValues(values: string[]): string[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const normalized = value.trim().toLocaleLowerCase('ru');
    if (!normalized) continue;
    const current = counts.get(normalized);
    counts.set(normalized, {
      value: current?.value ?? value.trim(),
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()]
    .filter((item) => item.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((item) => item.value);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(from).valueOf();
  const end = new Date(to).valueOf();
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}
