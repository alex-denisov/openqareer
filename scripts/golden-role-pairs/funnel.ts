/**
 * Воронка подбора кандидата на проде, только чтение: SQL-окно → сведение → роль → география,
 * затем ворота уровня, разбивка по уровням и образцы строк. Роли и условия лежат в зашифрованном
 * профиле, поэтому берутся из `pairs.json`. Запуск как у `probe.ts`; профиль — переменная PROFILE.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import pairs from './pairs.json';
import { loadGeoDirectory } from '../../shared/geo/geoDirectory';
import { deriveCandidateTargetLevel } from '../../server/vacancies/candidateLevel';
import { careerGeographyOf, withinCareerGeography } from '../../server/vacancies/careerGeography';
import { LEVEL_RANK } from '../../server/vacancies/levelMatcher';
import { matchGeographyOf } from '../../server/vacancies/matchGeography';
import { dropForeignRemote, markGeography } from '../../server/vacancies/vacancyGeography';
import { buildSemanticMatchQuery } from '../../server/vacancies/semanticMatchQuery';
import { parseVacancy } from '../../server/vacancies/sqliteVacancyPoolStore';
import { clusterVacancies } from '../../server/vacancies/vacancyDeduplicator';
import { matchCandidateWithVacancy } from '../../server/vacancies/vacancyMatcher';
import { normalizeTitleKey } from '../../server/vacancies/titleParse/normalizeTitleKey';
import {
  campaignLevelFloor,
  campaignLevelMatch,
  campaignLevelWindow,
  candidateRoleFunctionCodes,
} from '../../server/vacancies/titleParse/candidateRoleFunctions';

await loadGeoDirectory();

interface FunnelProfile {
  readonly id: string;
  readonly roles: readonly string[];
  readonly searchLocations?: readonly string[];
}

const DAY_MS = 86_400_000;
const profileId = process.env.PROFILE ?? 'adenisov-test-live';
const profile = (pairs.profiles as unknown as FunnelProfile[]).find((item) => item.id === profileId);
if (!profile) throw new Error(`нет профиля ${profileId}`);
const db = new DatabaseSync('/var/lib/openqareer/openqareer.db', { readOnly: true });
db.exec('PRAGMA query_only=1; PRAGMA busy_timeout=2000');

const roles = [...profile.roles];
const career = careerGeographyOf({ searchLocations: [...(profile.searchLocations ?? [])] });
const targetLevel = deriveCandidateTargetLevel({ targetRoles: roles, experience: [] });
const levelWindow = campaignLevelWindow(roles, targetLevel);
const codes = candidateRoleFunctionCodes(roles);
const geography = matchGeographyOf(career);
const nowMs = Date.now();
const { sql, params } = buildSemanticMatchQuery({
  functionCodes: codes,
  levelRank: targetLevel ? LEVEL_RANK[targetLevel] : null,
  levelFloorRank: campaignLevelFloor(roles, targetLevel),
  functionLevelFloors: levelWindow.floors,
  functionSpecialistTitles: levelWindow.specialistTitles,
  ...(geography ? { geography } : {}),
  window: { fromMs: nowMs - 30 * DAY_MS, toMs: nowMs },
  preferRemote: true,
  limit: 4000,
});
const started = performance.now();
const rows = db.prepare(sql).all(...(params as SQLInputValue[])) as { payload: string }[];
const sqlMs = Math.round(performance.now() - started);
const vacancies = rows.flatMap((row) => parseVacancy(row.payload) ?? []);
const candidate = {
  candidateId: profile.id,
  targetRoles: roles,
  confirmedSkills: [],
  confirmedFacts: [],
  preferredRemote: true,
  semanticRoleFunctions: codes,
  ...(targetLevel ? { targetLevel } : {}),
};
const clusters = clusterVacancies(vacancies).filter((cluster) => cluster.status === 'active');
const matched = clusters.map((cluster) => ({
  cluster,
  explanation: matchCandidateWithVacancy(candidate as never, cluster),
}));
const byRole = matched.filter((item) => item.explanation.roleMatch !== 'none');
const placed = career ? byRole.filter((item) => withinCareerGeography(item, career)) : byRole;
const marked = markGeography(placed, (career?.regions ?? []) as never);
const finished = career ? dropForeignRemote(marked) : marked;

const parseOf = db.prepare('SELECT functions, level_rank, parsed_by FROM title_parse WHERE title_key = ?');
const count = (into: Record<string, number>, key: string) => ({ ...into, [key]: (into[key] ?? 0) + 1 });
let levels: Record<string, number> = {};
let gates: Record<string, number> = {};
let parsedBy: Record<string, number> = {};
let functionsAtIc: Record<string, number> = {};
const lines = finished.map((item) => {
  const title = item.cluster.canonicalTitle;
  const parsed = parseOf.get(normalizeTitleKey(title)) as
    | { functions: string; level_rank: number | null; parsed_by: string }
    | undefined;
  const gate = campaignLevelMatch(
    levelWindow,
    targetLevel,
    title,
    parsed && { functions: JSON.parse(parsed.functions) as string[], levelRank: parsed.level_rank },
  );
  const level = String(parsed?.level_rank ?? 'unknown');
  levels = count(levels, level);
  gates = count(gates, gate);
  parsedBy = count(parsedBy, parsed?.parsed_by ?? 'none');
  if (parsed?.level_rank === 0) functionsAtIc = count(functionsAtIc, parsed.functions);
  return { id: item.cluster.id, title, location: item.cluster.canonicalLocation, level, gate, functions: parsed?.functions, salary: item.cluster.salary };
});
const has = (pattern: RegExp) => lines.filter((line) => pattern.test(line.title)).length;
process.stdout.write(
  `${JSON.stringify({
    profile: profile.id,
    targetLevel,
    codes,
    floors: levelWindow.floors,
    specialistTitles: levelWindow.specialistTitles,
    sqlMs,
    sqlRows: rows.length,
    clusters: clusters.length,
    byRole: byRole.length,
    placed: placed.length,
    total: lines.length,
    levels,
    gates,
    parsedBy,
    cto: has(/(?<!\p{L})(cto|chief technology officer|технический директор|технического директора)(?!\p{L})/iu),
    cio: has(/(?<!\p{L})(cio|chief information officer|ит[- ]директор|директор по ит|директор по информационным|it director)(?!\p{L})/iu),
    supportHeads: has(/(поддержк|support|сервис|customer care).*(руковод|директор|head|director|vp|vice)|(руковод|директор|head|director|vp|vice).*(поддержк|support|сервис|customer care)/iu),
    functionsAtIc: Object.entries(functionsAtIc).sort((a, b) => b[1] - a[1]).slice(0, 25),
  })}\n`,
);
for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
