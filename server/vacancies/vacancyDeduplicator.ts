import type { UnifiedVacancy, VacancyCluster, VacancyProvenance } from '../domain/unifiedVacancy';
import { normalizeTextForComparison } from './vacancyFingerprint';

const ATS_URL_REGEX =
  /(https?:\/\/(?:boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|[a-z0-9-]+\.recruitee\.com)\/[^\s"')]+)/i;

export function getSourcePriority(provenance: VacancyProvenance): number {
  if (
    provenance.sourceId.startsWith('ats_') ||
    provenance.sourceType === 'career_site' ||
    provenance.sourceType === 'direct'
  ) {
    return 10;
  }
  if (provenance.sourceType === 'hh' || provenance.sourceType === 'browser_session') {
    return 8;
  }
  if (provenance.sourceType === 'remotive' || provenance.sourceType === 'json_api') {
    return 6;
  }
  if (provenance.sourceType === 'rss') {
    return 4;
  }
  if (provenance.sourceType === 'telegram') {
    return 2;
  }
  return 1;
}

function normalizeRoleTitle(title: string): string {
  return title
    .replace(/\b(developer|engineer|разработчик|инженер)\b/gi, 'dev')
    .replace(/\b(golang|go)\b/gi, 'go')
    .replace(/\b(front[- ]?end|фронтенд)\b/gi, 'frontend')
    .replace(/\b(back[- ]?end|бэкенд)\b/gi, 'backend');
}

function extractAtsLink(text?: string): string | null {
  if (!text) return null;
  const match = ATS_URL_REGEX.exec(text);
  if (!match) return null;
  return match[1]
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function tokenize(text: string): Set<string> {
  const words = normalizeTextForComparison(text)
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return new Set(words);
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

function cleanCompanyName(company: string): string {
  return normalizeTextForComparison(company)
    .replace(/\b(llc|ltd|inc|corp|gmbh|ооо|зао|пао|ип)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Вакансия, разобранная один раз.
 *
 * Сведение сравнивает каждую вакансию с каждым уже собранным кластером, и до
 * B202 это стоило недорого — пул был меньше двух тысяч. С досками
 * работодателей пул вырос до 4836, и повторный разбор строк на каждое
 * сравнение (токенизация названия и работодателя, нормализация ссылки) занял
 * 45 секунд при запуске: прод не успевал ответить на проверку здоровья, и
 * выкат откатывался. Правила сравнения те же — меняется только то, что разбор
 * делается один раз на запись, а не миллионы раз на пару.
 */
interface PreparedVacancy {
  readonly fingerprint: string;
  readonly url: string;
  readonly atsLink: string | null;
  readonly company: string;
  readonly companyTokens: Set<string>;
  readonly roleTitleTokens: Set<string>;
  readonly normalizedTitle: string;
}

function prepareVacancy(vacancy: UnifiedVacancy): PreparedVacancy {
  const company = cleanCompanyName(vacancy.company);
  return {
    fingerprint: vacancy.fingerprint,
    url: normalizeUrl(vacancy.url),
    atsLink: extractAtsLink(vacancy.url) || extractAtsLink(vacancy.description),
    company,
    companyTokens: tokenize(company),
    roleTitleTokens: tokenize(normalizeRoleTitle(vacancy.title)),
    normalizedTitle: normalizeTextForComparison(vacancy.title),
  };
}

function isDuplicatePrepared(a: PreparedVacancy, b: PreparedVacancy): boolean {
  if (a.fingerprint === b.fingerprint) return true;
  if (a.url && b.url && a.url === b.url) return true;
  if (a.atsLink && b.atsLink && a.atsLink === b.atsLink) return true;

  if (!a.company || !b.company) return false;

  const exactCompany =
    a.company === b.company || a.company.includes(b.company) || b.company.includes(a.company);
  if (!exactCompany && jaccardSimilarity(a.companyTokens, b.companyTokens) < 0.75) {
    return false;
  }

  if (jaccardSimilarity(a.roleTitleTokens, b.roleTitleTokens) >= 0.45) return true;

  return (
    a.normalizedTitle.includes(b.normalizedTitle) || b.normalizedTitle.includes(a.normalizedTitle)
  );
}

export function isDuplicateVacancy(a: UnifiedVacancy, b: UnifiedVacancy): boolean {
  return isDuplicatePrepared(prepareVacancy(a), prepareVacancy(b));
}

function pickHigherPrioritySource(cluster: VacancyCluster, vacancy: UnifiedVacancy): void {
  const currentCanonical = cluster.sources.reduce(
    (highest, curr) => (getSourcePriority(curr) > getSourcePriority(highest) ? curr : highest),
    cluster.sources[0],
  );
  const newPrio = getSourcePriority(vacancy.provenance);
  const currentPrio = getSourcePriority(currentCanonical);
  if (newPrio > currentPrio) {
    cluster.primaryUrl = vacancy.url;
    cluster.canonicalTitle = vacancy.title;
    cluster.canonicalCompany = vacancy.company;
  }
}

function updateClusterLocation(cluster: VacancyCluster, location?: string): void {
  if (!location) return;
  const isGeneric =
    !cluster.canonicalLocation || /remote|удален|worldwide/i.test(cluster.canonicalLocation);
  const newIsSpecific = !/remote|удален|worldwide/i.test(location);
  if (isGeneric && newIsSpecific) {
    cluster.canonicalLocation = location;
  }
}

function mergeVacancyIntoCluster(cluster: VacancyCluster, vacancy: UnifiedVacancy) {
  cluster.vacanciesCount += 1;
  pickHigherPrioritySource(cluster, vacancy);

  const alreadyHasSource = cluster.sources.some(
    (s) =>
      s.sourceId === vacancy.provenance.sourceId &&
      s.sourceType === vacancy.provenance.sourceType &&
      s.sourceUrl === vacancy.provenance.sourceUrl,
  );
  if (!alreadyHasSource) {
    cluster.sources.push(vacancy.provenance);
  }

  const skillSet = new Set([...cluster.skills, ...vacancy.requiredSkills]);
  cluster.skills = Array.from(skillSet);

  if (!cluster.salary && vacancy.salary) {
    cluster.salary = vacancy.salary;
  } else if (cluster.salary && vacancy.salary && !cluster.salary.to && vacancy.salary.to) {
    cluster.salary = vacancy.salary;
  }

  updateClusterLocation(cluster, vacancy.location);

  if (new Date(vacancy.publishedAt) < new Date(cluster.firstObservedAt)) {
    cluster.firstObservedAt = vacancy.publishedAt;
  }
  if (new Date(vacancy.provenance.observedAt) > new Date(cluster.lastSeenAt)) {
    cluster.lastSeenAt = vacancy.provenance.observedAt;
  }
}

function createClusterFromVacancy(vacancy: UnifiedVacancy): VacancyCluster {
  return {
    id: `cluster-${vacancy.id}`,
    canonicalTitle: vacancy.title,
    canonicalCompany: vacancy.company,
    canonicalLocation: vacancy.location,
    isRemote: Boolean(vacancy.isRemote),
    salary: vacancy.salary,
    descriptionSummary: (vacancy.description ?? '').slice(0, 300),
    skills: [...vacancy.requiredSkills],
    primaryUrl: vacancy.url,
    sources: [vacancy.provenance],
    firstObservedAt: vacancy.publishedAt,
    lastSeenAt: vacancy.provenance.observedAt,
    status: vacancy.status,
    vacanciesCount: 1,
  };
}

/**
 * Индекс кандидатов на слияние (B216).
 *
 * До него каждая новая запись сравнивалась с каждым собранным кластером:
 * на 42 462 записях прода это 203 секунды на одну пересборку — при окне
 * проверки здоровья в 20 секунд выкат откатывался, а после каждой волны опроса
 * сервер молчал три минуты (прод 2026-09-14). Правила «одна и та же вакансия»
 * не меняются; меняется только то, с кем вообще есть смысл сравнивать.
 *
 * Два кластера могут совпасть только если у них общий отпечаток, общая
 * ссылка, общая ATS-ссылка, либо общий токен работодателя И общий токен
 * названия (Жаккар ≥ 0,75 по работодателю и ≥ 0,45 по названию без общего
 * токена невозможен). Единственное, что индекс не находит, — вложение строки
 * работодателя без общего токена. На пуле прода 2026-09-14 (42 460 записей,
 * 203 с → 6,5 с) все такие пары были ложными склейками: «ОТР» внутри
 * «Роспотребнадзора», «ФАКТОР» внутри «Лидфактор», «Сбер» внутри
 * «СберЛизинг». Индекс их больше не сводит, и это правильнее старого.
 */
class ClusterIndex {
  private readonly byFingerprint = new Map<string, number>();
  private readonly byUrl = new Map<string, number[]>();
  private readonly byAtsLink = new Map<string, number[]>();
  private readonly byCompanyToken = new Map<string, number[]>();
  private readonly byTitleToken = new Map<string, number[]>();
  private readonly representatives: PreparedVacancy[] = [];

  public add(index: number, prepared: PreparedVacancy): void {
    this.representatives[index] = prepared;
    this.byFingerprint.set(prepared.fingerprint, index);
    if (prepared.url) push(this.byUrl, prepared.url, index);
    if (prepared.atsLink) push(this.byAtsLink, prepared.atsLink, index);
    for (const token of prepared.companyTokens) push(this.byCompanyToken, token, index);
    for (const token of prepared.roleTitleTokens) push(this.byTitleToken, token, index);
  }

  /** Индексы кластеров, с которыми запись вообще может совпасть, по возрастанию. */
  public candidates(prepared: PreparedVacancy): number[] {
    const found = new Set<number>();
    const direct = this.byFingerprint.get(prepared.fingerprint);
    if (direct !== undefined) found.add(direct);
    for (const index of this.byUrl.get(prepared.url) ?? []) found.add(index);
    if (prepared.atsLink) {
      for (const index of this.byAtsLink.get(prepared.atsLink) ?? []) found.add(index);
    }
    for (const index of this.sameCompanyAndTitle(prepared)) found.add(index);
    return Array.from(found).sort((a, b) => a - b);
  }

  /**
   * Пересечение «общий токен работодателя» ∩ «общий токен названия» считается
   * со стороны меньшего множества: у крупного работодателя тысячи вакансий, а
   * токен «engineer» есть у половины пула — обходить большее из них на каждую
   * запись и есть квадрат.
   */
  private sameCompanyAndTitle(prepared: PreparedVacancy): Iterable<number> {
    if (prepared.companyTokens.size === 0 || prepared.roleTitleTokens.size === 0) return [];
    const byCompany = this.union(this.byCompanyToken, prepared.companyTokens);
    if (byCompany.size === 0) return [];
    const titleBucketsSize = this.bucketsSize(this.byTitleToken, prepared.roleTitleTokens);
    if (titleBucketsSize < byCompany.size) {
      const byTitle = this.union(this.byTitleToken, prepared.roleTitleTokens);
      return Array.from(byTitle).filter((index) => byCompany.has(index));
    }
    return Array.from(byCompany).filter((index) =>
      sharesToken(prepared.roleTitleTokens, this.representatives[index]!.roleTitleTokens),
    );
  }

  private union(map: Map<string, number[]>, tokens: Set<string>): Set<number> {
    const result = new Set<number>();
    for (const token of tokens) for (const index of map.get(token) ?? []) result.add(index);
    return result;
  }

  private bucketsSize(map: Map<string, number[]>, tokens: Set<string>): number {
    let total = 0;
    for (const token of tokens) total += map.get(token)?.length ?? 0;
    return total;
  }
}

function sharesToken(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) return true;
  return false;
}

function push(map: Map<string, number[]>, key: string, index: number): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(index);
  else map.set(key, [index]);
}

function addVacancyToClusterIndex(
  vacancy: UnifiedVacancy,
  clusters: VacancyCluster[],
  prepared: PreparedVacancy[],
  index: ClusterIndex,
): void {
  const candidate = prepareVacancy(vacancy);
  const match = index
    .candidates(candidate)
    .find((position) => isDuplicatePrepared(candidate, prepared[position]!));

  if (match !== undefined) {
    mergeVacancyIntoCluster(clusters[match]!, vacancy);
    const representative = prepareCluster(clusters[match]!);
    prepared[match] = representative;
    index.add(match, representative);
  } else {
    const cluster = createClusterFromVacancy(vacancy);
    clusters.push(cluster);
    const representative = prepareCluster(cluster);
    prepared.push(representative);
    index.add(clusters.length - 1, representative);
  }
}

export function clusterVacancies(vacancies: UnifiedVacancy[]): VacancyCluster[] {
  const clusters: VacancyCluster[] = [];
  const prepared: PreparedVacancy[] = [];
  const index = new ClusterIndex();

  for (const vacancy of vacancies) {
    addVacancyToClusterIndex(vacancy, clusters, prepared, index);
  }

  return clusters;
}

export async function clusterVacanciesAsync(
  vacancies: UnifiedVacancy[],
  chunkSize = 500,
): Promise<VacancyCluster[]> {
  const clusters: VacancyCluster[] = [];
  const prepared: PreparedVacancy[] = [];
  const index = new ClusterIndex();

  let count = 0;
  for (const vacancy of vacancies) {
    addVacancyToClusterIndex(vacancy, clusters, prepared, index);
    count += 1;
    if (count % chunkSize === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return clusters;
}

function prepareCluster(cluster: VacancyCluster): PreparedVacancy {
  const company = cleanCompanyName(cluster.canonicalCompany);
  return {
    fingerprint: cluster.id,
    url: normalizeUrl(cluster.primaryUrl),
    atsLink: extractAtsLink(cluster.primaryUrl) || extractAtsLink(cluster.descriptionSummary),
    company,
    companyTokens: tokenize(company),
    roleTitleTokens: tokenize(normalizeRoleTitle(cluster.canonicalTitle)),
    normalizedTitle: normalizeTextForComparison(cluster.canonicalTitle),
  };
}

export interface SourceAuthenticityResult {
  readonly originalShare: { readonly counted: number; readonly of: number };
  readonly reprintShare: { readonly counted: number; readonly of: number };
}

function isReprintInCluster(sourceId: string, cluster: VacancyCluster): boolean {
  const fromSource = cluster.sources.find((s) => s.sourceId === sourceId);
  if (!fromSource) return false;

  const isDirect =
    sourceId.startsWith('ats_') ||
    fromSource.sourceType === 'career_site' ||
    fromSource.sourceType === 'direct';
  if (isDirect) return false;

  const hasDirect = cluster.sources.some(
    (s) =>
      s.sourceId !== sourceId &&
      (s.sourceId.startsWith('ats_') ||
        s.sourceType === 'career_site' ||
        s.sourceType === 'direct'),
  );
  if (hasDirect) return true;

  const thisObserved = Date.parse(fromSource.observedAt);
  return cluster.sources.some((s) => {
    if (s.sourceId === sourceId) return false;
    const otherObserved = Date.parse(s.observedAt);
    return (
      !Number.isNaN(otherObserved) &&
      !Number.isNaN(thisObserved) &&
      thisObserved - otherObserved > 3600_000
    );
  });
}

export function calculateSourceAuthenticity(
  sourceId: string,
  clusters: readonly VacancyCluster[],
): SourceAuthenticityResult {
  let total = 0;
  let reprints = 0;

  for (const cluster of clusters) {
    if (cluster.sources.some((s) => s.sourceId === sourceId)) {
      total += 1;
      if (isReprintInCluster(sourceId, cluster)) {
        reprints += 1;
      }
    }
  }

  const originals = total - reprints;
  return {
    originalShare: { counted: originals, of: total },
    reprintShare: { counted: reprints, of: total },
  };
}
