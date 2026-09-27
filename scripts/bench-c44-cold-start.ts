import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { readMatchProfile } from '../server/vacancies/matchedPoolContext';
import { readCampaign } from '../server/routes/campaignContext';
import { readTargetLevel } from '../server/routes/vacancyRoleContext';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { candidateRoleFunctionCodes } from '../server/vacancies/titleParse/candidateRoleFunctions';
import { LEVEL_RANK } from '../server/vacancies/levelMatcher';
import { buildSemanticMatchQuery } from '../server/vacancies/semanticMatchQuery';
import { DEFAULT_MATCH_CANDIDATE_LIMIT, freshnessWindow } from '../server/vacancies/vacancyPoolQuery';
import { VacancyMatchReader } from '../server/vacancies/vacancyMatchReader';
import { clusterVacancies } from '../server/vacancies/vacancyDeduplicator';
import { matchCandidateWithVacancy } from '../server/vacancies/vacancyMatcher';
import { compareMatchedVacancies } from '../shared/vacancyMatchOrder';
import { parseVacancy } from '../server/vacancies/sqliteVacancyPoolStore';

function duration(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

function dataEncryptionKey(): Buffer {
  const encoded = process.env.OPENQAREER_DATA_ENCRYPTION_KEY;
  const key = encoded ? Buffer.from(encoded, 'base64') : undefined;
  if (!key || key.length !== 32) {
    throw new Error('OPENQAREER_DATA_ENCRYPTION_KEY must contain the production-format 32-byte key');
  }
  return key;
}

function rankCandidate(
  rows: readonly { payload: string }[],
  candidateId: string,
  roles: readonly string[],
  targetLevel: ReturnType<typeof readTargetLevel>,
  confirmedSkills: readonly string[],
  functions: ReturnType<typeof candidateRoleFunctionCodes>,
) {
  const parseStartedAt = performance.now();
  const vacancies = rows.flatMap((row) => {
    const parsed = parseVacancy(row.payload);
    return parsed ? [parsed] : [];
  });
  const clusterStartedAt = performance.now();
  const items = clusterVacancies(vacancies)
    .filter((cluster) => cluster.status === 'active')
    .map((cluster) => ({ cluster, explanation: matchCandidateWithVacancy({
      candidateId, targetRoles: roles, targetLevel, confirmedSkills, confirmedFacts: confirmedSkills,
      preferredRemote: true, semanticRoleFunctions: functions,
    }, cluster) }))
    .sort(compareMatchedVacancies);
  return { items, clusterJsonParseMs: duration(parseStartedAt), clusterJsonAndClustersMs: duration(clusterStartedAt) };
}

async function child(databasePath: string, candidateId: string): Promise<void> {
  const store = new SqliteCandidateStore({ databasePath, encryptionKey: dataEncryptionKey() });
  const candidate = store.getSnapshot(candidateId);
  if (!candidate) throw new Error('candidate_not_found');
  const { confirmedSkills } = readMatchProfile(store, candidateId);
  const campaign = readCampaign(store, candidateId);
  const roles = [...campaign.roles.value];
  const targetLevel = readTargetLevel(store, candidateId, roles);
  const functions = candidateRoleFunctionCodes(roles);
  if (!functions.length) throw new Error('candidate_campaign_has_no_semantic_function');
  const queryStartedAt = performance.now();
  const query = buildSemanticMatchQuery({
    functionCodes: functions,
    levelRank: targetLevel ? LEVEL_RANK[targetLevel] : null,
    window: freshnessWindow(Date.now()),
    preferRemote: true,
    limit: DEFAULT_MATCH_CANDIDATE_LIMIT,
  });
  const queryBuildMs = duration(queryStartedAt);
  const reader = new VacancyMatchReader(databasePath, 60_000, 1);
  try {
    const sqlStartedAt = performance.now();
    const rows = await reader.read(query.sql, query.params);
    const sqliteAndReaderMs = duration(sqlStartedAt);
    const ranked = rankCandidate(rows, candidateId, roles, targetLevel, confirmedSkills, functions);
    process.stdout.write(`${JSON.stringify({
      event: 'matched-vacancies-timing',
      mode: 'semantic',
      cold: true,
      queryBuildMs,
      sqliteAndReaderMs,
      clusterJsonParseMs: ranked.clusterJsonParseMs,
      clusterJsonAndClustersMs: ranked.clusterJsonAndClustersMs,
      matched: ranked.items.length,
    })}\n`);
  } finally {
    reader.close();
    store.close();
  }
}

async function parent(databasePath: string, candidateId: string, runs: number): Promise<void> {
  const purge = process.platform === 'darwin' ? spawnSync('purge', [], { stdio: 'ignore' }) : undefined;
  const osCache = purge?.status === 0 ? 'purged' : 'warm';
  for (let run = 1; run <= runs; run += 1) {
    const worker = spawn(process.execPath, ['--import', 'tsx', import.meta.filename, '--child', databasePath, candidateId], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    worker.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    await once(worker, 'exit');
    if (worker.exitCode !== 0) throw new Error('cold_start_child_failed');
    process.stdout.write(`${JSON.stringify({ run, process: 'new', osCache, timing: JSON.parse(output) })}\n`);
  }
}

const [flag, databasePath, candidateId, rawRuns] = process.argv.slice(2);
if (flag === '--child' && databasePath && candidateId) await child(databasePath, candidateId);
else if (databasePath && candidateId) await parent(databasePath, candidateId, Number(rawRuns ?? 1));
else throw new Error('usage: npx tsx scripts/bench-c44-cold-start.ts <database-path> <candidate-id> [runs]');
