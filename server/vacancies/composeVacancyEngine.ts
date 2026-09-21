import { searchHhVacancies } from '../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../connectors/remotiveVacancySearch';
import { HhCrawlCoordinator } from './hhCrawlCoordinator';
import { createHhCrawlSettings, type SqliteHhCrawlSettings } from './hhCrawlSettings';
import { buildHhPageFetcher } from './hhSearchTransport';
import { createHttpLinkProbe } from './linkLivenessProbe';
import { buildMultiSourceFetcher, fetchRobotsTxt } from './multiSourceFetcher';
import type { LinkProbe } from './linkLivenessProbe';
import {
  MultiSourceVacancyEngine,
  type ReclusterMode,
  type SourceFetcher,
} from './multiSourceVacancyEngine';
import { RobotsPolicyLoader, type RobotsFetcher } from './robotsPolicyLoader';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';

export interface ComposedVacancyEngine {
  readonly engine: MultiSourceVacancyEngine;
  readonly pool: SqliteVacancyPoolStore;
  readonly hhCrawlSettings: SqliteHhCrawlSettings;
  readonly hhCrawlCoordinator: HhCrawlCoordinator;
  close(): void;
}

export interface ComposeVacancyEngineOptions {
  readonly databasePath: string;
  /** Подмена сети в тестах: по умолчанию — настоящие площадки, robots и ссылки. */
  readonly fetcher?: SourceFetcher;
  readonly fetchRobots?: RobotsFetcher;
  readonly linkProbe?: LinkProbe;
  readonly recluster?: ReclusterMode;
  /** Свидетель транзакций записи пула — журнал обслуживателя (PRB-043 срез 2). */
  readonly onPoolWrite?: (event: PoolWriteEvent) => void;
}

/**
 * Одна сборка движка пула для обоих процессов (B230): HTTP отвечает из пула,
 * обслуживатель его пополняет. Раньше всё это жило в `server/index.ts`, и
 * второй процесс неизбежно разошёлся бы с первым по набору площадок или
 * настройкам обхода — а расходятся они молча.
 */
export function composeVacancyEngine(options: ComposeVacancyEngineOptions): ComposedVacancyEngine {
  const pool = new SqliteVacancyPoolStore({
    databasePath: options.databasePath,
    ...(options.onPoolWrite ? { onWrite: options.onPoolWrite } : {}),
  });
  // Настройки веера обхода hh.ru: набор ролей выбирает владелец, отметка
  // глубокого прохода переживает выкат (B214).
  const hhCrawlSettings = createHhCrawlSettings({ databasePath: options.databasePath });
  const hhCrawlCoordinator = new HhCrawlCoordinator(hhCrawlSettings, {
    fetchPage: buildHhPageFetcher(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Быстрый проход останавливается на странице, где пул всё уже знает (B219).
    // Движок собирается ниже, поэтому спрашивается через замыкание, а не значением.
    isKnown: (id: string): boolean => engine.hasVacancy(id),
  });
  const engine: MultiSourceVacancyEngine = new MultiSourceVacancyEngine({
    fetcher:
      options.fetcher ??
      buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, hhCrawlCoordinator),
    pool,
    // Право обхода спрашивается у самой площадки, а не берётся из записи,
    // сделанной когда-то руками; `Crawl-delay` тоже приходит оттуда (B204).
    robots: new RobotsPolicyLoader({ fetchRobots: options.fetchRobots ?? fetchRobotsTxt }),
    // Открывается ли ещё ссылка объявления — отдельное доказательство: лента
    // может отдавать свежие даты у вакансий, которых на сайте уже нет (B200
    // срез 2).
    linkProbe: options.linkProbe ?? createHttpLinkProbe(),
    ...(options.recluster ? { recluster: options.recluster } : {}),
  });
  return {
    engine,
    pool,
    hhCrawlSettings,
    hhCrawlCoordinator,
    close: () => {
      pool.close();
      hhCrawlSettings.close();
    },
  };
}
