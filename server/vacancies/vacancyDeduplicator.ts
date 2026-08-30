import type { UnifiedVacancy, VacancyCluster, VacancySourceType } from '../domain/unifiedVacancy';
import { normalizeTextForComparison } from './vacancyFingerprint';

const SOURCE_PRIORITY: Record<VacancySourceType, number> = {
  career_site: 5,
  direct: 5,
  hh: 4,
  // A board's own JSON record carries structured fields the RSS summary drops,
  // so it wins a tie against a feed describing the same vacancy (B164).
  json_api: 3,
  remotive: 3,
  rss: 2,
  telegram: 1,
};

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

export function isDuplicateVacancy(a: UnifiedVacancy, b: UnifiedVacancy): boolean {
  if (a.fingerprint === b.fingerprint) return true;

  const compA = cleanCompanyName(a.company);
  const compB = cleanCompanyName(b.company);
  if (!compA || !compB) return false;

  const companyOverlap = jaccardSimilarity(tokenize(compA), tokenize(compB));
  const exactCompany = compA === compB || compA.includes(compB) || compB.includes(compA);
  if (!exactCompany && companyOverlap < 0.8) {
    return false;
  }

  const titleTokensA = tokenize(a.title);
  const titleTokensB = tokenize(b.title);
  const titleOverlap = jaccardSimilarity(titleTokensA, titleTokensB);
  return titleOverlap >= 0.5;
}

function mergeVacancyIntoCluster(cluster: VacancyCluster, vacancy: UnifiedVacancy) {
  cluster.vacanciesCount += 1;
  cluster.sources.push(vacancy.provenance);

  const skillSet = new Set([...cluster.skills, ...vacancy.requiredSkills]);
  cluster.skills = Array.from(skillSet);

  if (!cluster.salary && vacancy.salary) {
    cluster.salary = vacancy.salary;
  } else if (cluster.salary && vacancy.salary && !cluster.salary.to && vacancy.salary.to) {
    cluster.salary = vacancy.salary;
  }

  const currentPrio = SOURCE_PRIORITY[cluster.sources[0].sourceType] ?? 0;
  const newPrio = SOURCE_PRIORITY[vacancy.provenance.sourceType] ?? 0;
  if (newPrio > currentPrio) {
    cluster.primaryUrl = vacancy.url;
    cluster.canonicalTitle = vacancy.title;
    cluster.canonicalCompany = vacancy.company;
  }

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
