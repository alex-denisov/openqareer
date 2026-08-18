import type {
  UnifiedVacancy,
  VacancyCluster,
  VacancyMatchExplanation,
  VacancySourceConfig,
} from '../domain/unifiedVacancy';
import { clusterVacancies } from './vacancyDeduplicator';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';

export type SourceFetcher = (source: VacancySourceConfig) => Promise<UnifiedVacancy[]>;

export interface MatchedVacancyItem {
  cluster: VacancyCluster;
  explanation: VacancyMatchExplanation;
}

const DEFAULT_SOURCES: VacancySourceConfig[] = [
  {
    id: 'src-hh-default',
    name: 'hh.ru (Россия & СНГ)',
    type: 'hh',
    enabled: true,
    targetUrl: 'https://api.hh.ru/vacancies',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-remotive-default',
    name: 'Remotive (Global Remote)',
    type: 'remotive',
    enabled: true,
    targetUrl: 'https://remotive.com/api/remote-jobs',
    refreshIntervalMinutes: 120,
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
];

export class MultiSourceVacancyEngine {
  private sources: Map<string, VacancySourceConfig> = new Map();
  private rawVacancies: Map<string, UnifiedVacancy> = new Map(); // id -> vacancy
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

  public addOrUpdateSource(source: VacancySourceConfig): void {
    this.sources.set(source.id, { ...source });
  }

  public removeSource(id: string): boolean {
    return this.sources.delete(id);
  }

  public getActiveClusters(): VacancyCluster[] {
    return this.clusters.filter((c) => c.status === 'active');
  }

  public async syncSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || !source.enabled) return;

    try {
      let fetched: UnifiedVacancy[] = [];
      if (this.fetcher) {
        fetched = await this.fetcher(source);
      } else {
        // Fallback default mock/live fetch if no custom fetcher injected
        fetched = [];
      }

      // Store vacancies
      for (const item of fetched) {
        this.rawVacancies.set(item.id, item);
      }

      // Update source metrics
      source.lastSyncAt = new Date().toISOString();
      source.lastStatus = 'healthy';
      source.lastErrorMessage = undefined;
      source.itemsFoundTotal = fetched.length;
      source.itemsActiveTotal = fetched.filter((v) => v.status === 'active').length;

      // Re-cluster all active vacancies
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
    const allVacancies = Array.from(this.rawVacancies.values());
    this.clusters = clusterVacancies(allVacancies);
  }

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const active = this.getActiveClusters();
    const matched: MatchedVacancyItem[] = [];

    for (const cluster of active) {
      const explanation = matchCandidateWithVacancy(candidate, cluster);
      matched.push({ cluster, explanation });
    }

    // Sort by match score descending
    return matched.sort((a, b) => b.explanation.matchScore - a.explanation.matchScore);
  }
}
