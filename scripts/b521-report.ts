import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { matchCandidateWithVacancy } from '../server/vacancies/vacancyMatcher';
import { compareMatchedVacancies } from '../shared/vacancyMatchOrder';
import { extractVacancyRequirements } from '../server/domain/vacancyRequirements';
import type { VacancyCluster, UnifiedVacancy } from '../server/domain/unifiedVacancy';

const vault = join(homedir(), '.openqareer/research/B521');
const read = (name: string) => JSON.parse(readFileSync(join(vault, name), 'utf8'));
const snapshot = read('pool-snapshot.json');
const sample: Array<{ id: string; source: string; description: string }> = read('sample.json');
const trial = read('trial.json');
const pairs: Array<{ id: string; vacancyId: string; title: string; profile: { id: string; title: string; facts: string[] } }> = read('pairs-to-label.json');
const labels: Array<{ id: string; label: string }> = read('labelled-pairs.json');
const sourceRows: Array<{ id: string; payload: string }> = [...read('baseline-source-rows.json'), ...read('label-baseline-source-rows.json')];
const sources = new Map(sourceRows.map((row) => [row.id, JSON.parse(row.payload) as UnifiedVacancy]));
const labelMap = new Map(labels.map((row) => [row.id, row.label]));
const percentile = (values: number[], fraction: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
};
const profiles = [...new Map(pairs.map((pair) => [pair.profile.id, pair.profile])).values()];
const skills: Record<string, string[]> = {
  'synthetic-software': ['TypeScript', 'Node.js', 'PostgreSQL', 'Kubernetes'],
  'synthetic-sales': ['B2B sales', 'CRM', 'enterprise account management'],
  'synthetic-finance': ['Excel', 'IFRS', 'financial reporting', 'tax accounting'],
};
const baseline = profiles.map((profile) => {
  const ranked = pairs.filter((pair) => pair.profile.id === profile.id).map((pair) => {
    const vacancy = sources.get(pair.vacancyId);
    if (!vacancy) throw new Error('A labelled posting has no baseline source row');
    const cluster: VacancyCluster = {
      id: vacancy.id, canonicalTitle: vacancy.title, canonicalCompany: vacancy.company,
      canonicalLocation: vacancy.location, isRemote: vacancy.isRemote ?? false,
      descriptionSummary: vacancy.fullDescription ?? vacancy.description, skills: vacancy.requiredSkills ?? [],
      primaryUrl: vacancy.url, sources: [vacancy.provenance], firstObservedAt: vacancy.publishedAt,
      lastSeenAt: vacancy.publishedAt, status: vacancy.status, vacanciesCount: 1,
    };
    const explanation = matchCandidateWithVacancy({ candidateId: profile.id, targetRoles: [profile.title],
      confirmedSkills: skills[profile.id], confirmedFacts: profile.facts }, cluster);
    return { cluster, explanation, label: labelMap.get(pair.id) };
  }).sort(compareMatchedVacancies);
  const top = ranked.slice(0, 10);
  return { profile: profile.id, pairs: ranked.length,
    roleGateSurvivors: ranked.filter((row) => row.explanation.roleMatch !== 'none').length,
    levelAndRegionGateCounts: null,
    gateLimitation: 'Synthetic profiles do not prove work authorization, specific region or seniority eligibility.',
    precisionAt10: top.filter((row) => row.label === 'suitable').length / top.length,
    disputedAt10: top.filter((row) => row.label === 'disputed').length,
    noAt10: top.filter((row) => row.label === 'no').length,
  };
});
const providers = [...new Set<string>(trial.results.map((row: { provider: string }) => row.provider))].map((provider) => {
  const rows = trial.results.filter((row: { provider: string }) => row.provider === provider);
  const successful = rows.filter((row: { usage?: { cost?: number } }) => typeof row.usage?.cost === 'number');
  const requirements = successful.flatMap((row: { requirements?: unknown[] }) => row.requirements ?? []);
  return { provider, attempted: rows.length, successful: successful.length,
    http429: rows.filter((row: { httpStatus?: number }) => row.httpStatus === 429).length,
    p50Ms: percentile(successful.map((row: { elapsedMs: number }) => row.elapsedMs), 0.5),
    p95Ms: percentile(successful.map((row: { elapsedMs: number }) => row.elapsedMs), 0.95),
    promptTokens: successful.reduce((sum: number, row: { usage: { prompt_tokens?: number } }) => sum + (row.usage.prompt_tokens ?? 0), 0),
    outputTokens: successful.reduce((sum: number, row: { usage: { completion_tokens?: number } }) => sum + (row.usage.completion_tokens ?? 0), 0),
    reasoningTokens: successful.reduce((sum: number, row: { usage: { completion_tokens_details?: { reasoning_tokens?: number } } }) => sum + (row.usage.completion_tokens_details?.reasoning_tokens ?? 0), 0),
    cachedTokens: successful.reduce((sum: number, row: { usage: { prompt_tokens_details?: { cached_tokens?: number } } }) => sum + (row.usage.prompt_tokens_details?.cached_tokens ?? 0), 0),
    actualReportedUsd: successful.reduce((sum: number, row: { usage: { cost: number } }) => sum + row.usage.cost, 0),
    nonemptyOutputs: successful.filter((row: { requirements?: unknown[] }) => row.requirements?.length).length,
    totalRequirementClaims: requirements.length,
    exactSourceQuotes: successful.reduce((sum: number, row: { validQuotes?: number }) => sum + (row.validQuotes ?? 0), 0),
  };
});
const ruleResults = sample.map((row) => ({ source: row.source, result: extractVacancyRequirements({ vacancyId: row.id, description: row.description }) }));
const report = {
  generatedAt: new Date().toISOString(), snapshotAt: snapshot.measuredAt, pool: snapshot.totals,
  observedLast24hIsNotNetGrowth: true, netDailyGrowth: null,
  measurementLimitation: 'A single index snapshot cannot establish net growth without a prior comparable snapshot.',
  snapshotSamples: snapshot.samples.length, snapshotDescriptions: snapshot.samples.filter((row: { description: string }) => row.description).length,
  labelledPairs: labels.length, labelCounts: labels.reduce((counts: Record<string, number>, row) => { counts[row.label] = (counts[row.label] ?? 0) + 1; return counts; }, {}),
  labelProvenance: 'Model-assisted career-role review of real posting snippets and explicitly synthetic profiles; not owner/human ground truth.',
  baseline, providers, trialFinishedAt: trial.finishedAt,
  billedKnownUsd: trial.spentUsd, unresolvedReservedUsd: trial.heldUsd, capUsd: trial.limitUsd,
  trialStopped: trial.stopped, ruleSample: sample.length,
  rulesExtracted: ruleResults.filter((row) => row.result.status === 'extracted').length,
  ruleBySource: [...new Set(sample.map((row) => row.source))].map((source) => ({ source,
    total: ruleResults.filter((row) => row.source === source).length,
    extracted: ruleResults.filter((row) => row.source === source && row.result.status === 'extracted').length })),
  conclusion: 'Rules first. Current low-price DeepSeek routes are not proven reliable for bulk production. Gemini has measured extraction coverage but mandatory reasoning; it is not silently substituted into the reasoning-disabled client. Keep model fallback capped and disabled until an eligible route is accepted.',
};
const target = 'docs/v1-release/tasks/evidence/B521';
mkdirSync(target, { recursive: true });
writeFileSync(join(target, 'measurements.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
