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
  return match[1].replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
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

function hasUrlOverlap(a: UnifiedVacancy, b: UnifiedVacancy): boolean {
  const urlA = normalizeUrl(a.url);
  const urlB = normalizeUrl(b.url);
  if (urlA && urlB && urlA === urlB) return true;

  const atsA = extractAtsLink(a.url) || extractAtsLink(a.description);
  const atsB = extractAtsLink(b.url) || extractAtsLink(b.description);
  return Boolean(atsA && atsB && atsA === atsB);
}

export function isDuplicateVacancy(a: UnifiedVacancy, b: UnifiedVacancy): boolean {
  if (a.fingerprint === b.fingerprint) return true;
  if (hasUrlOverlap(a, b)) return true;

  const compA = cleanCompanyName(a.company);
  const compB = cleanCompanyName(b.company);
  if (!compA || !compB) return false;

  const companyOverlap = jaccardSimilarity(tokenize(compA), tokenize(compB));
  const exactCompany = compA === compB || compA.includes(compB) || compB.includes(compA);
  if (!exactCompany && companyOverlap < 0.75) {
    return false;
  }

  const titleTokensA = tokenize(normalizeRoleTitle(a.title));
  const titleTokensB = tokenize(normalizeRoleTitle(b.title));
  const titleOverlap = jaccardSimilarity(titleTokensA, titleTokensB);
  if (titleOverlap >= 0.45) return true;

  const normTitleA = normalizeTextForComparison(a.title);
  const normTitleB = normalizeTextForComparison(b.title);
  return normTitleA.includes(normTitleB) || normTitleB.includes(normTitleA);
}

function pickHigherPrioritySource(cluster: VacancyCluster, vacancy: UnifiedVacancy): void {
  const currentCanonical = cluster.sources.reduce((highest, curr) =>
    getSourcePriority(curr) > getSourcePriority(highest) ? curr : highest,
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
  const isGeneric = !cluster.canonicalLocation || /remote|удален|worldwide/i.test(cluster.canonicalLocation);
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
    descriptionSummary: vacancy.description.slice(0, 300),
    skills: [...vacancy.requiredSkills],
    primaryUrl: vacancy.url,
    sources: [vacancy.provenance],
    firstObservedAt: vacancy.publishedAt,
    lastSeenAt: vacancy.provenance.observedAt,
    status: vacancy.status,
    vacanciesCount: 1,
  };
}

export function clusterVacancies(vacancies: UnifiedVacancy[]): VacancyCluster[] {
  const clusters: VacancyCluster[] = [];

  for (const vacancy of vacancies) {
    const matchedCluster = clusters.find((cluster) => {
      const representative: UnifiedVacancy = {
        id: cluster.id,
        fingerprint: cluster.id,
        title: cluster.canonicalTitle,
        company: cluster.canonicalCompany,
        location: cluster.canonicalLocation,
        isRemote: cluster.isRemote,
        salary: cluster.salary,
        description: cluster.descriptionSummary,
        requiredSkills: cluster.skills,
        url: cluster.primaryUrl,
        provenance: cluster.sources[0],
        publishedAt: cluster.firstObservedAt,
        status: cluster.status,
      };
      return isDuplicateVacancy(vacancy, representative);
    });

    if (matchedCluster) {
      mergeVacancyIntoCluster(matchedCluster, vacancy);
    } else {
      clusters.push(createClusterFromVacancy(vacancy));
    }
  }

  return clusters;
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
    return !Number.isNaN(otherObserved) && !Number.isNaN(thisObserved) && thisObserved - otherObserved > 3600_000;
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
