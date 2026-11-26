/**
 * B725: реестр источников подборки на минуту вперёд.
 *
 * Прод 20.11: у движка ~74 тыс. источников (доски компаний). Каждая страница
 * подборки заново копировала их и сливала в реестр с id — 76 мс локально,
 * ~95 мс на проде (`beforeCampaignMs`). Пул на 154 страницы платил это 154
 * раза. Новый источник в реестре через минуту ничего не ломает: он нужен
 * только для имён площадок и проверки фильтра по источнику.
 */
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import {
  matchedVacancySourceRegistry,
  type MatchedVacancySourceDefinition,
} from './matchedVacancyFacets';

export const SOURCE_REGISTRY_TTL_MS = 60_000;

export interface MatchedSourceRegistry {
  readonly registry: readonly MatchedVacancySourceDefinition[];
  readonly knownSourceIds: readonly string[];
}

interface SourceEngine {
  getSources?(): VacancySourceConfig[];
}

interface Entry {
  readonly at: number;
  readonly value: MatchedSourceRegistry;
}

const cache = new WeakMap<SourceEngine, Entry>();

export function cachedMatchedSourceRegistry(
  engine: SourceEngine,
  now: number = Date.now(),
): MatchedSourceRegistry {
  const entry = cache.get(engine);
  if (entry && now - entry.at < SOURCE_REGISTRY_TTL_MS) return entry.value;
  const registry = matchedVacancySourceRegistry(engine.getSources?.() ?? []);
  const value = { registry, knownSourceIds: registry.map(({ id }) => id) };
  cache.set(engine, { at: now, value });
  return value;
}
