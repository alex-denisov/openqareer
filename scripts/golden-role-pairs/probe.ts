/**
 * Замер эталонных пар на проде, только чтение. Запуск:
 *   npx esbuild scripts/golden-role-pairs/probe.ts --bundle --platform=node --format=esm --outfile=<tmp>.mjs \
 *     --external:node:sqlite
 *   ssh openqareer-de-1 "cd /tmp && nice -n 19 timeout 300 node --no-warnings --input-type=module" < <tmp>.mjs
 * Меряет SQL-окно подбора (функция, уровень, география) до точной проверки и порядка по проценту.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import pairs from './pairs.json';
import { loadGeoDirectory } from '../../shared/geo/geoDirectory';
import { deriveCandidateTargetLevel } from '../../server/vacancies/candidateLevel';
import { LEVEL_RANK } from '../../server/vacancies/levelMatcher';
import { matchGeographyOf } from '../../server/vacancies/matchGeography';
import { buildSemanticMatchQuery } from '../../server/vacancies/semanticMatchQuery';
import {
  campaignLevelWindow,
  campaignLevelFloor,
  candidateRoleFunctionCodes,
} from '../../server/vacancies/titleParse/candidateRoleFunctions';

await loadGeoDirectory();

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const LIMIT = 4000;
const nowMs = Date.now();
const db = new DatabaseSync('/var/lib/openqareer/openqareer.db', { readOnly: true });
db.exec('PRAGMA query_only=1; PRAGMA busy_timeout=2000');

interface Profile {
  readonly id: string;
  readonly roles: readonly string[];
  readonly geography?: { readonly places: string[]; readonly remote: boolean; readonly remoteRegions: string[] };
  readonly must: readonly (readonly [string, string])[];
  readonly mustNot: readonly (readonly [string, string])[];
}

function selection(profile: Profile, geographic: boolean) {
  const targetLevel = deriveCandidateTargetLevel({ targetRoles: profile.roles, experience: [] });
  const geography = geographic && profile.geography ? matchGeographyOf(profile.geography as never) : undefined;
  const levelWindow = campaignLevelWindow(profile.roles, targetLevel);
  const { sql, params } = buildSemanticMatchQuery({
    functionCodes: candidateRoleFunctionCodes(profile.roles),
    levelRank: targetLevel ? LEVEL_RANK[targetLevel] : null,
    levelFloorRank: campaignLevelFloor(profile.roles, targetLevel),
    functionLevelFloors: levelWindow.floors,
    functionSpecialistTitles: levelWindow.specialistTitles,
    ...(geography ? { geography } : {}),
    window: { fromMs: nowMs - WINDOW_DAYS * DAY_MS, toMs: nowMs },
    preferRemote: false,
    limit: LIMIT,
  });
  const started = performance.now();
  const rows = db
    .prepare(sql.replace('c.cluster_json AS payload', 'c.id AS id'))
    .all(...(params as SQLInputValue[])) as { id: string }[];
  return { ms: Math.round(performance.now() - started), ids: new Set(rows.map((row) => row.id)), targetLevel };
}

const inPool = db.prepare('SELECT 1 AS ok FROM vacancy_cluster_input WHERE id = ?');
const semantic = db.prepare(
  'SELECT group_concat(function_code || \':\' || ifnull(level_rank, \'-\')) AS parsed FROM vacancy_semantic WHERE id = ?',
);

function score(profile: Profile, ids: ReadonlySet<string>) {
  const live = (list: Profile['must']) => list.filter(([id]) => inPool.get(id));
  const must = live(profile.must);
  const mustNot = live(profile.mustNot);
  const missed = must.filter(([id]) => !ids.has(id));
  const extra = mustNot.filter(([id]) => ids.has(id));
  const line = ([id, title]: readonly [string, string]) => `${title} [${(semantic.get(id) as { parsed: string | null }).parsed}]`;
  return {
    found: `${must.length - missed.length}/${must.length}`,
    extra: `${extra.length}/${mustNot.length}`,
    outOfPool: profile.must.length + profile.mustNot.length - must.length - mustNot.length,
    missed: missed.map(line),
    extraTitles: extra.map(line),
  };
}

for (const profile of pairs.profiles as unknown as Profile[]) {
  const open = selection(profile, false);
  process.stdout.write(
    `${JSON.stringify({ profile: profile.id, level: open.targetLevel, codes: candidateRoleFunctionCodes(profile.roles), rows: open.ids.size, ms: open.ms, ...score(profile, open.ids) })}\n`,
  );
  if (profile.geography) {
    const near = selection(profile, true);
    process.stdout.write(
      `${JSON.stringify({ profile: `${profile.id}+geo`, rows: near.ids.size, ms: near.ms, ...score(profile, near.ids) })}\n`,
    );
  }
}
