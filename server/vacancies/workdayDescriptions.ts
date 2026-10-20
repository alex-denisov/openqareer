import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { extractSkillsFromText } from '../connectors/telegramChannelParser';
import { detailTextSourceFor, isDetailTextSource, type DetailFormat } from './detailTextSources';
import { WORKDAY_SOURCE_PREFIX } from './workdayBoardSources';

/**
 * Дочитывание текста вакансий Workday (B535).
 *
 * Список Workday описаний не отдаёт, и до этого среза карточка несла склейку
 * «название — город» под видом описания. Полный текст есть только в запросе
 * по одной вакансии: `GET https://<host>/wday/cxs/<tenant>/<site><externalPath>`
 * → `jobPostingInfo.jobDescription` (HTML). На проде 20.10 таких записей
 * 5 613 в 13 тенантах, поэтому дочитывание — фоновый шаг воркера обслуживания:
 * не больше `perSource` запросов на хост за тик, хосты параллельно, внутри
 * хоста по одному с паузой. Новые записи идут первыми.
 *
 * Тот же шаг дочитывает и другие площадки без текста в списке —
 * SmartRecruiters, Eightfold, Habr Career, YC (`detailTextSources.ts`).
 */

const DESCRIPTION_SNIPPET_CHARS = 500;
const DEFAULT_PER_SOURCE = 2;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1_500;
const DETAIL_TIMEOUT_MS = 20_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)';
const ACCEPT: Readonly<Record<DetailFormat, string>> = {
  json: 'application/json',
  html: 'text/html,application/xhtml+xml',
};

export interface WorkdayDetailResponse {
  readonly status: number;
  readonly payload?: unknown;
}

/** `payload` — разобранный JSON для `json` и строка страницы для `html`. */
export type WorkdayDetailFetch = (
  url: string,
  format: DetailFormat,
) => Promise<WorkdayDetailResponse>;

/** Ровно то, что шагу нужно от хранилища пула. */
export interface WorkdayDescriptionPool {
  loadVacanciesWithoutFullText(
    sourceId: string,
    limit: number,
    excludeIds: readonly string[],
  ): UnifiedVacancy[];
  mergeSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): unknown;
  markExpired(vacancyIds: readonly string[], atIso: string): number;
}

export interface WorkdayDescriptionReport {
  readonly requested: number;
  readonly loaded: number;
  readonly gone: number;
  readonly failed: number;
}

export function isWorkdaySource(sourceId: string): boolean {
  return sourceId.startsWith(WORKDAY_SOURCE_PREFIX);
}

/**
 * Публичная ссылка `https://<host>/<site>/job/...` → адрес cxs. Тенант берётся
 * из id источника, хост обязан быть `*.myworkdayjobs.com`: иначе запрос ушёл бы
 * туда, куда указала чужая запись.
 */
export function workdayDetailUrl(sourceId: string, publicUrl: string): string | undefined {
  if (!isWorkdaySource(sourceId)) return undefined;
  return detailTextSourceFor(sourceId)?.detailUrl(sourceId, { url: publicUrl });
}

export function readWorkdayDescription(payload: unknown): string {
  return detailTextSourceFor(WORKDAY_SOURCE_PREFIX)?.readText(payload) ?? '';
}

/**
 * Список отдаёт запись снова без текста: дочитанный текст остаётся. Без
 * дочитанного текста описание пустое — прежняя склейка «название — город»
 * описанием не была.
 */
export function mergeWorkdaySnapshot(
  existing: UnifiedVacancy,
  incoming: UnifiedVacancy,
): UnifiedVacancy {
  if (incoming.fullDescription?.trim() || !existing.fullDescription?.trim()) return incoming;
  return {
    ...incoming,
    description: existing.description,
    fullDescription: existing.fullDescription,
    requiredSkills: incoming.requiredSkills.length
      ? incoming.requiredSkills
      : [...existing.requiredSkills],
  };
}

function snippetOf(fullText: string): string {
  const flat = fullText.replace(/\s+/g, ' ').trim();
  if (flat.length <= DESCRIPTION_SNIPPET_CHARS) return flat;
  const cut = flat.slice(0, DESCRIPTION_SNIPPET_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function withWorkdayText(vacancy: UnifiedVacancy, fullText: string): UnifiedVacancy {
  return {
    ...vacancy,
    description: snippetOf(fullText),
    fullDescription: fullText,
    requiredSkills: vacancy.requiredSkills.length
      ? vacancy.requiredSkills
      : extractSkillsFromText(fullText),
  };
}

export const fetchWorkdayDetail: WorkdayDetailFetch = async (url, format) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT[format] },
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status };
  }
  return { status: res.status, payload: format === 'json' ? await res.json() : await res.text() };
};

type Outcome = 'loaded' | 'gone' | 'failed';

export class WorkdayDescriptionBackfill {
  private readonly pool: WorkdayDescriptionPool;
  private readonly sourceIds: () => readonly string[];
  private readonly fetchDetail: WorkdayDetailFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly perSource: number;
  private readonly maxAttempts: number;
  private readonly delayMs: number;
  /** Неудачи по id: после `maxAttempts` запись больше не запрашивается до перезапуска. */
  private readonly attempts = new Map<string, number>();
  private running = false;

  constructor(options: {
    pool: WorkdayDescriptionPool;
    sourceIds: () => readonly string[];
    fetchDetail?: WorkdayDetailFetch;
    sleep?: (ms: number) => Promise<void>;
    perSource?: number;
    maxAttempts?: number;
    delayMs?: number;
  }) {
    this.pool = options.pool;
    this.sourceIds = options.sourceIds;
    this.fetchDetail = options.fetchDetail ?? fetchWorkdayDetail;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.perSource = options.perSource ?? DEFAULT_PER_SOURCE;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  }

  /** Один тик; если прошлый ещё идёт, новый не начинается. */
  async step(): Promise<WorkdayDescriptionReport> {
    if (this.running) return { requested: 0, loaded: 0, gone: 0, failed: 0 };
    this.running = true;
    try {
      const sources = this.sourceIds().filter(isDetailTextSource);
      const outcomes = await Promise.all(sources.map((sourceId) => this.stepSource(sourceId)));
      const flat = outcomes.flat();
      return {
        requested: flat.length,
        loaded: flat.filter((o) => o === 'loaded').length,
        gone: flat.filter((o) => o === 'gone').length,
        failed: flat.filter((o) => o === 'failed').length,
      };
    } finally {
      this.running = false;
    }
  }

  private exhaustedIds(): string[] {
    return [...this.attempts].filter(([, count]) => count >= this.maxAttempts).map(([id]) => id);
  }

  private async stepSource(sourceId: string): Promise<Outcome[]> {
    const batch = this.pool.loadVacanciesWithoutFullText(
      sourceId,
      this.perSource,
      this.exhaustedIds(),
    );
    const outcomes: Outcome[] = [];
    for (let index = 0; index < batch.length; index += 1) {
      if (index > 0) await this.sleep(this.delayMs);
      outcomes.push(await this.loadOne(sourceId, batch[index]!));
    }
    return outcomes;
  }

  private async loadOne(sourceId: string, vacancy: UnifiedVacancy): Promise<Outcome> {
    const source = detailTextSourceFor(sourceId);
    const url = source?.detailUrl(sourceId, vacancy);
    if (!source || !url) return this.fail(vacancy.id, this.maxAttempts);
    let response: WorkdayDetailResponse;
    try {
      response = await this.fetchDetail(url, source.format);
    } catch {
      return this.fail(vacancy.id);
    }
    if (response.status === 404 || response.status === 410) {
      this.pool.markExpired([vacancy.id], new Date().toISOString());
      this.attempts.delete(vacancy.id);
      return 'gone';
    }
    const fullText = response.status === 200 ? source.readText(response.payload) : '';
    if (!fullText) return this.fail(vacancy.id);
    this.pool.mergeSourceSlice(sourceId, [withWorkdayText(vacancy, fullText)]);
    this.attempts.delete(vacancy.id);
    return 'loaded';
  }

  private fail(id: string, by = 1): Outcome {
    this.attempts.set(id, (this.attempts.get(id) ?? 0) + by);
    return 'failed';
  }
}
