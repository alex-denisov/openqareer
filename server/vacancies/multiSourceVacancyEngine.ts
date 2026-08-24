import type {
  UnifiedVacancy,
  VacancyCluster,
  VacancyMatchExplanation,
  VacancySourceConfig,
} from '../domain/unifiedVacancy';
import { clusterVacancies } from './vacancyDeduplicator';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';

export type SourceFetcher = (
  source: VacancySourceConfig,
  options?: { query?: string },
) => Promise<UnifiedVacancy[]>;

export interface MatchedVacancyItem {
  cluster: VacancyCluster;
  explanation: VacancyMatchExplanation;
}

export interface VacancyQueryFilter {
  sourceId?: string;
  type?: string;
  query?: string;
  isRemote?: boolean;
  limit?: number;
  offset?: number;
}

export interface VacancyQueryResult {
  total: number;
  items: UnifiedVacancy[];
  statsBySource: Array<{ sourceId: string; sourceName: string; count: number }>;
}

/**
 * Sources the product knows how to contact. Counts and status stay empty
 * until a real fetch happens: a configured source is not an observed one
 * (B161).
 */
const DEFAULT_SOURCES: VacancySourceConfig[] = [
  {
    id: 'hh',
    name: 'hh.ru (Россия & СНГ)',
    type: 'hh',
    enabled: true,
    targetUrl: 'https://api.hh.ru/vacancies',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'remotive',
    name: 'Remotive (Global Remote)',
    type: 'remotive',
    enabled: true,
    targetUrl: 'https://remotive.com/api/remote-jobs',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-habr-career',
    name: 'Хабр Карьера',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://career.habr.com/vacancies/rss',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-superjob',
    name: 'SuperJob IT',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://superjob.ru/export/it.xml',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-zarplata',
    name: 'Зарплата.ру',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://zarplata.ru/export/vacancies.xml',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-trudvsem',
    name: 'Работа в России (ТрудВсем)',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://opendata.trudvsem.ru/vacancies.xml',
    refreshIntervalMinutes: 180,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-weworkremotely',
    name: 'We Work Remotely',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-remoteok',
    name: 'RemoteOK',
    type: 'rss',
    enabled: true,
    targetUrl: 'https://remoteok.com/api',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-itjobs',
    name: 'Telegram @it_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/it_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-tproger',
    name: 'Telegram @tproger_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/tproger_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-react',
    name: 'Telegram @job_react',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/job_react',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-backend',
    name: 'Telegram @forphptut',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/forphptut',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-devops',
    name: 'Telegram @devops_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/devops_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-qa',
    name: 'Telegram @qa_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/qa_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-product',
    name: 'Telegram @product_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/product_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-datascience',
    name: 'Telegram @datasciencejobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/datasciencejobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-relocate',
    name: 'Telegram @relocate_today',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/relocate_today',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-gamedev',
    name: 'Telegram @gamedevjob',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/gamedevjob',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-uiux',
    name: 'Telegram @uiuxjobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/uiuxjobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-ios',
    name: 'Telegram @ios_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/ios_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-marketing',
    name: 'Telegram @marketing_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/marketing_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-golang',
    name: 'Telegram @golang_jobs',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/golang_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-python',
    name: 'Telegram @python_jobs_feed',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/python_jobs_feed',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-java',
    name: 'Telegram @javajob',
    type: 'telegram',
    enabled: true,
    targetUrl: 'https://t.me/s/javajob',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
];


const MAX_VACANCY_AGE_DAYS = 30;

function isVacancyFresh(
  publishedAt: string,
  nowMs: number = Date.now(),
  maxAgeDays: number = MAX_VACANCY_AGE_DAYS,
): boolean {
  const pubTime = new Date(publishedAt).getTime();
  if (Number.isNaN(pubTime)) return false;
  const ageMs = nowMs - pubTime;
  return ageMs >= 0 && ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export class MultiSourceVacancyEngine {
  private sources: Map<string, VacancySourceConfig> = new Map();
  private rawVacancies: Map<string, UnifiedVacancy> = new Map();
  private clusters: VacancyCluster[] = [];
  private fetcher?: SourceFetcher;

  constructor(options?: {
    sources?: VacancySourceConfig[];
    fetcher?: SourceFetcher;
  }) {
    const initial = options?.sources ?? DEFAULT_SOURCES;
    for (const src of initial) {
      this.sources.set(src.id, { ...src });
    }
    this.fetcher = options?.fetcher;
  }

  public getSources(): VacancySourceConfig[] {
    return Array.from(this.sources.values());
  }

  public getSource(id: string): VacancySourceConfig | undefined {
    return this.sources.get(id);
  }

  public addOrUpdateSource(source: VacancySourceConfig): void {
    this.sources.set(source.id, { ...source });
  }

  public toggleSource(sourceId: string, enabled: boolean): VacancySourceConfig {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Источник ${sourceId} не найден`);
    source.enabled = enabled;
    return { ...source };
  }

  public removeSource(id: string): boolean {
    return this.sources.delete(id);
  }

  public getActiveClusters(): VacancyCluster[] {
    return this.clusters.filter((c) => c.status === 'active');
  }

  public getVacancies(filter: VacancyQueryFilter = {}): VacancyQueryResult {
    let all = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );

    const statsMap = new Map<string, number>();
    for (const v of all) {
      const sId = v.provenance?.sourceId ?? 'unknown';
      statsMap.set(sId, (statsMap.get(sId) ?? 0) + 1);
    }
    const statsBySource = Array.from(this.sources.values()).map((s) => ({
      sourceId: s.id,
      sourceName: s.name,
      count: statsMap.get(s.id) ?? 0,
    }));

    if (filter.sourceId) {
      all = all.filter((v) => v.provenance?.sourceId === filter.sourceId);
    }
    if (filter.type) {
      all = all.filter((v) => v.provenance?.sourceType === filter.type);
    }
    if (filter.isRemote !== undefined) {
      all = all.filter((v) => v.isRemote === filter.isRemote);
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      all = all.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.company.toLowerCase().includes(q) ||
          (v.description && v.description.toLowerCase().includes(q)) ||
          v.requiredSkills.some((s) => s.toLowerCase().includes(q)),
      );
    }

    // Sort newest first
    all.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 20;
    const items = all.slice(offset, offset + limit);

    return {
      total,
      items,
      statsBySource,
    };
  }

  public async syncSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || !source.enabled) return;

    try {
      // No transport means the source was never contacted. Reporting that as a
      // healthy empty result would be a measurement we never took (B161).
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const fetched: UnifiedVacancy[] = await this.fetcher(source);

      const freshFetched = fetched.filter((v) => isVacancyFresh(v.publishedAt));

      for (const item of freshFetched) {
        this.rawVacancies.set(item.id, item);
      }

      source.lastSyncAt = new Date().toISOString();
      source.lastStatus = 'healthy';
      source.lastErrorMessage = undefined;
      source.itemsFoundTotal = freshFetched.length;
      source.itemsActiveTotal = freshFetched.filter((v) => v.status === 'active').length;

      this.recluster();
    } catch (err) {
      source.lastSyncAt = new Date().toISOString();
      source.lastStatus = 'error';
      source.lastErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  public async syncAll(): Promise<void> {
    const enabled = Array.from(this.sources.values()).filter((s) => s.enabled);
    await Promise.all(enabled.map((s) => this.syncSource(s.id)));
  }

  public recluster(): void {
    const freshVacancies = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );
    this.clusters = clusterVacancies(freshVacancies);
  }

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const active = this.getActiveClusters();
    const matched: MatchedVacancyItem[] = [];

    for (const cluster of active) {
      const explanation = matchCandidateWithVacancy(candidate, cluster);
      matched.push({ cluster, explanation });
    }

    return matched.sort((a, b) => b.explanation.matchScore - a.explanation.matchScore);
  }


  public async testSource(
    sourceId: string,
    query?: string,
  ): Promise<{
    sourceId: string;
    sourceName: string;
    type: string;
    success: boolean;
    latencyMs: number;
    count: number;
    vacancies: UnifiedVacancy[];
    message?: string;
  }> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Источник вакансий ${sourceId} не найден`);
    }
    const start = Date.now();
    try {
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const fetched: UnifiedVacancy[] = await this.fetcher(source, { query });
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: true,
        latencyMs,
        count: fetched.length,
        vacancies: fetched.slice(0, 15),
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: false,
        latencyMs,
        count: 0,
        vacancies: [],
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
