/**
 * Порядок «по совпадению» на эталонных парах, только чтение, запуск как у probe.ts. У синтетических
 * профилей нет процентов, поэтому сравнивается порядок окна SQL до и после подъёма точной роли:
 * сколько нужных и лишних строк в верхних 40 и сколько стоит проверка роли на всём окне.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import pairs from './pairs.json';
import { loadGeoDirectory } from '../../shared/geo/geoDirectory';
import { exactRoleTest } from '../../server/routes/matchedFitRelevance';
import { deriveCandidateTargetLevel } from '../../server/vacancies/candidateLevel';
import { LEVEL_RANK } from '../../server/vacancies/levelMatcher';
import { buildSemanticMatchQuery } from '../../server/vacancies/semanticMatchQuery';
import {
  campaignLevelFloor,
  campaignLevelWindow,
  candidateRoleFunctionCodes,
} from '../../server/vacancies/titleParse/candidateRoleFunctions';

await loadGeoDirectory();

const TOP = 40;
const DAY_MS = 86_400_000;
const nowMs = Date.now();
const db = new DatabaseSync('/var/lib/openqareer/openqareer.db', { readOnly: true });
db.exec('PRAGMA query_only=1; PRAGMA busy_timeout=2000');

interface Profile {
  readonly id: string;
  readonly roles: readonly string[];
  readonly must: readonly (readonly [string, string])[];
  readonly mustNot: readonly (readonly [string, string])[];
}

function selection(profile: Profile): { id: string; title: string }[] {
  const targetLevel = deriveCandidateTargetLevel({
    targetRoles: [...profile.roles],
    experience: [],
  });
  const levelWindow = campaignLevelWindow([...profile.roles], targetLevel);
  const { sql, params } = buildSemanticMatchQuery({
    functionCodes: candidateRoleFunctionCodes([...profile.roles]),
    levelRank: targetLevel ? LEVEL_RANK[targetLevel] : null,
    levelFloorRank: campaignLevelFloor([...profile.roles], targetLevel),
    functionLevelFloors: levelWindow.floors,
    functionSpecialistTitles: levelWindow.specialistTitles,
    window: { fromMs: nowMs - 30 * DAY_MS, toMs: nowMs },
    preferRemote: false,
    limit: 4000,
  });
  const rows = db
    .prepare(
      sql.replace(
        'c.cluster_json AS payload',
        "c.id AS id, coalesce(json_extract(c.cluster_json, '$.canonicalTitle'), json_extract(c.cluster_json, '$.title'), '') AS title",
      ),
    )
    .all(...(params as SQLInputValue[]));
  return rows as unknown as { id: string; title: string }[];
}

for (const profile of pairs.profiles as unknown as Profile[]) {
  const rows = selection(profile);
  const started = performance.now();
  const isExact = exactRoleTest(profile.roles);
  const flags = new Map(rows.map((row) => [row.id, isExact(row.title)]));
  const roleMs = Math.round(performance.now() - started);
  const after = [...rows].sort((a, b) => Number(flags.get(b.id)) - Number(flags.get(a.id)));
  const inTop = (list: typeof rows, wanted: Profile['must']) => {
    const ids = new Set(list.slice(0, TOP).map((row) => row.id));
    return wanted.filter(([id]) => ids.has(id)).length;
  };
  const exactInTop = (list: typeof rows) =>
    list.slice(0, TOP).filter((row) => flags.get(row.id)).length;
  process.stdout.write(
    `${JSON.stringify({
      profile: profile.id,
      rows: rows.length,
      exact: rows.filter((row) => flags.get(row.id)).length,
      roleMs,
      before: {
        exactTop: exactInTop(rows),
        must: inTop(rows, profile.must),
        mustNot: inTop(rows, profile.mustNot),
      },
      after: {
        exactTop: exactInTop(after),
        must: inTop(after, profile.must),
        mustNot: inTop(after, profile.mustNot),
      },
      kept: new Set(after.map((row) => row.id)).size === new Set(rows.map((row) => row.id)).size,
      mustNotExact: profile.mustNot.filter(([id]) => flags.get(id)).map(([, title]) => title),
      top: after.slice(0, 8).map((row) => row.title),
    })}\n`,
  );
}
