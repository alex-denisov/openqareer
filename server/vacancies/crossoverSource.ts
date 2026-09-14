import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { SourceReading } from './multiSourceVacancyEngine';
import { asArray, buildJsonVacancy, fromIso, isUsableVacancy, record, text } from './jsonVacancyRecord';

/**
 * Crossover (B217). Открытого списка вакансий у площадки нет: `profile-api`
 * отвечает 403 без ключа, а ключ из бандла — уже обход. Зато две честные
 * половины есть: sitemap называет открытые вакансии адресами
 * `/jobs/<id>/<brand>/<slug>` (99 на 2026-09-14), а описания лежат в Kentico
 * Delivery API без ключа (`kontent-proxy.crossover.com`, тип `pipeline`,
 * `pipeline_code` = id из sitemap). Карточка собирается из обеих.
 */
export const CROSSOVER_SOURCE_ID = 'src-crossover';
export const CROSSOVER_SITEMAP_URL = 'https://www.crossover.com/sitemap.xml';
export const CROSSOVER_KONTENT_URL = 'https://kontent-proxy.crossover.com/items';

/** Kentico режет фильтр `[in]` по длине адреса; 50 кодов — с запасом. */
const KONTENT_BATCH = 50;
const KONTENT_ELEMENTS = [
  'pipeline_code',
  'hook',
  'what_you_will_be_doing',
  'responsibilities',
  'requirements',
  'nice_to_have',
  'work_location',
  'remote_policy',
  'weekly_hours',
  'functional_domain',
  'brand',
];

export interface CrossoverSitemapJob {
  readonly id: string;
  readonly brand: string;
  readonly slug: string;
  readonly url: string;
}

export interface CrossoverSourceAddresses {
  readonly sitemapUrl: string;
  readonly kontentUrl: string;
}

export interface CrossoverFetchDeps {
  readonly fetchText: (url: string) => Promise<string>;
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly observedAt: string;
}

const JOB_URL = /^https:\/\/www\.crossover\.com\/jobs\/(\d+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/i;

export function parseCrossoverSitemap(xml: string): CrossoverSitemapJob[] {
  const seen = new Set<string>();
  const jobs: CrossoverSitemapJob[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = match[1]!.split('?')[0]!;
    const parts = JOB_URL.exec(url);
    if (!parts || seen.has(parts[1]!)) continue;
    seen.add(parts[1]!);
    jobs.push({ id: parts[1]!, brand: parts[2]!, slug: parts[3]!, url });
  }
  return jobs;
}

function kontentUrl(base: string, codes: readonly string[]): string {
  const url = new URL(base);
  url.searchParams.set('system.type', 'pipeline');
  url.searchParams.set('elements.pipeline_code[in]', codes.join(','));
  url.searchParams.set('elements', KONTENT_ELEMENTS.join(','));
  url.searchParams.set('limit', String(KONTENT_BATCH));
  url.searchParams.set('depth', '0');
  return url.toString();
}

function elementText(elements: Record<string, unknown>, name: string): string {
  return text(record(elements[name]).value);
}

function elementNames(elements: Record<string, unknown>, name: string): string[] {
  return (asArray(record(elements[name]).value) ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : text(record(entry).name)))
    .filter(Boolean);
}

/** «Campus Operations Specialist, Alpha» → название без бренда в хвосте. */
function titleWithoutBrand(name: string, brandNames: readonly string[]): string {
  for (const brand of brandNames.filter(Boolean)) {
    const suffix = new RegExp(`,\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const stripped = name.replace(suffix, '').trim();
    if (stripped && stripped !== name.trim()) return stripped;
  }
  return name.trim();
}

/**
 * Бренд в `pipeline` — кодовое имя (`trilogy`, `n2_hour_learning`); человеческое
 * имя лежит в записях типа `brand`. Без справочника — из адреса sitemap.
 */
function brandName(
  elements: Record<string, unknown>,
  slugBrand: string,
  brands: ReadonlyMap<string, string>,
): string {
  const codename = elementNames(elements, 'brand')[0];
  const named = codename ? brands.get(codename) : undefined;
  return named ?? slugToName(slugBrand);
}

function slugToName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function brandsUrl(base: string): string {
  const url = new URL(base);
  url.searchParams.set('system.type', 'brand');
  url.searchParams.set('elements', 'name');
  url.searchParams.set('limit', '100');
  url.searchParams.set('depth', '0');
  return url.toString();
}

async function readBrands(base: string, fetchJson: CrossoverFetchDeps['fetchJson']): Promise<Map<string, string>> {
  const brands = new Map<string, string>();
  const payload = record(await fetchJson(brandsUrl(base)));
  for (const item of asArray(payload.items) ?? []) {
    const entry = record(item);
    const codename = text(record(entry.system).codename);
    const name = elementText(record(entry.elements), 'name') || text(record(entry.system).name);
    if (codename && name) brands.set(codename, name);
  }
  return brands;
}

function toVacancy(
  job: CrossoverSitemapJob,
  item: Record<string, unknown>,
  observedAt: string,
  brands: ReadonlyMap<string, string>,
): UnifiedVacancy {
  const system = record(item.system);
  const elements = record(item.elements);
  const brand = brandName(elements, job.brand, brands);
  const remotePolicy = elementNames(elements, 'remote_policy').join(', ');
  const location = elementText(elements, 'work_location');
  const description = [
    elementText(elements, 'hook'),
    elementText(elements, 'what_you_will_be_doing'),
    elementText(elements, 'responsibilities'),
    elementText(elements, 'requirements'),
    elementText(elements, 'nice_to_have'),
  ]
    .filter((part) => part.replace(/<[^>]+>|\s/g, '').length > 0)
    .join('\n');
  return buildJsonVacancy({
    sourceId: CROSSOVER_SOURCE_ID,
    context: { observedAt, sourceName: 'Crossover', sourceUrl: job.url },
    externalId: job.id,
    title: titleWithoutBrand(text(system.name), [brand, slugToName(job.brand)]),
    company: brand,
    location: location || undefined,
    isRemote: /remote/i.test(remotePolicy) || /remote/i.test(location),
    description: description || text(system.name),
    skills: elementNames(elements, 'functional_domain'),
    employmentType: elementText(elements, 'weekly_hours') || undefined,
    url: job.url,
    publishedAt: fromIso(system.last_modified),
  });
}

export async function fetchCrossover(
  addresses: CrossoverSourceAddresses,
  deps: CrossoverFetchDeps,
): Promise<SourceReading> {
  const jobs = parseCrossoverSitemap(await deps.fetchText(addresses.sitemapUrl));
  // Пустой sitemap — отказ площадки, а не ноль вакансий (B161).
  if (jobs.length === 0) throw new Error('crossover_sitemap_empty');
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const brands = await readBrands(addresses.kontentUrl, deps.fetchJson);
  const vacancies: UnifiedVacancy[] = [];
  for (let offset = 0; offset < jobs.length; offset += KONTENT_BATCH) {
    const codes = jobs.slice(offset, offset + KONTENT_BATCH).map((job) => job.id);
    const payload = record(await deps.fetchJson(kontentUrl(addresses.kontentUrl, codes)));
    for (const item of asArray(payload.items) ?? []) {
      const entry = record(item);
      const code = elementText(record(entry.elements), 'pipeline_code');
      const job = byId.get(code);
      if (job) vacancies.push(toVacancy(job, entry, deps.observedAt, brands));
    }
  }
  return { vacancies: vacancies.filter(isUsableVacancy), partial: false };
}
