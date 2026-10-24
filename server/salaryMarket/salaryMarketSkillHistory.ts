import type { DatabaseSync } from 'node:sqlite';
import { SALARY_REGIONAL_LOCATIONS, salaryLocationCohortKey } from './salaryMarketGeography';
import {
  MIN_SALARY_MARKET_SAMPLE,
  salarySkillTrendHasChanges,
  SALARY_MARKET_ROLE_LIMIT,
  type SalaryMarketGrade,
  type SalaryMarketSnapshot,
  type SalarySkillQuarterlyTrend,
  type SalarySkillFrequencyChange,
} from '../../shared/salaryMarketSnapshot';

/** Bump when classification, extraction, denominator or comparison semantics change. No cross-version comparison. */
export const SALARY_SKILL_HISTORY_METHOD_VERSION = 'b351-b267-skill-counts-v1';
const DAY_MS = 86_400_000;
const HISTORY_WEEKS = 16;
export const SALARY_SKILL_HISTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS salary_market_skill_history (
  role TEXT NOT NULL, week_start TEXT NOT NULL, method_version TEXT NOT NULL,
  observed_at TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(role, week_start, method_version)
) STRICT;
CREATE TABLE IF NOT EXISTS salary_market_skill_history_first (
  role TEXT NOT NULL, slice TEXT NOT NULL, method_version TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(role, slice, method_version)
) STRICT`;
interface SkillCount {
  readonly name: string;
  readonly count: number;
}
interface SkillSample {
  readonly sampleSize: number;
  readonly skills: readonly SkillCount[];
}
interface GradeSample extends SkillSample {
  readonly grade: SalaryMarketGrade;
}
export interface SalarySkillHistoryPoint extends SkillSample {
  readonly weekStart: string;
  readonly observedAt: string;
  readonly grades: readonly GradeSample[];
}
function validDenominator(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function utcWeekStart(observedAt: Date): string {
  const date = new Date(observedAt.toISOString().slice(0, 10) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function counts(sample: SkillSample): readonly SkillCount[] {
  return sample.skills
    .slice(0, 15)
    .filter(
      (skill) =>
        typeof skill.name === 'string' &&
        skill.name.length > 0 &&
        skill.name.length <= 128 &&
        Number.isSafeInteger(skill.count) &&
        skill.count >= 0 &&
        skill.count <= sample.sampleSize,
    )
    .map(({ name, count }) => ({ name, count }));
}
function firstObservation(
  database: DatabaseSync,
  role: string,
  slice: string,
  observedAt: string,
): void {
  database
    .prepare(
      `INSERT INTO salary_market_skill_history_first VALUES (?, ?, ?, ?)
    ON CONFLICT(role,slice,method_version) DO UPDATE SET observed_at=min(observed_at,excluded.observed_at)`,
    )
    .run(role, slice, SALARY_SKILL_HISTORY_METHOD_VERSION, observedAt);
}
function capturePoint(
  database: DatabaseSync,
  snapshot: SalaryMarketSnapshot,
  observedAt: Date,
): void {
  if (!validDenominator(snapshot.sampleSize)) return;
  const timestamp = observedAt.toISOString();
  const grades = (snapshot.gradeSlices ?? [])
    .filter((valid) => validDenominator(valid.sampleSize))
    .slice(0, 5)
    .map((slice) => ({ grade: slice.grade, sampleSize: slice.sampleSize, skills: counts(slice) }));
  const point = {
    observedAt: timestamp,
    sampleSize: snapshot.sampleSize,
    skills: counts(snapshot),
    grades,
  };
  database
    .prepare(
      `INSERT INTO salary_market_skill_history VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(role,week_start,method_version) DO NOTHING`,
    )
    .run(
      snapshot.role,
      utcWeekStart(observedAt),
      SALARY_SKILL_HISTORY_METHOD_VERSION,
      timestamp,
      JSON.stringify(point),
    );
  firstObservation(database, snapshot.role, 'all', timestamp);
  for (const grade of grades) firstObservation(database, snapshot.role, grade.grade, timestamp);
}
function cleanHistory(database: DatabaseSync, roles: readonly string[], now: Date): void {
  const week = utcWeekStart(now);
  const oldest = new Date(week + 'T00:00:00Z');
  oldest.setUTCDate(oldest.getUTCDate() - (HISTORY_WEEKS - 1) * 7);
  const keep = roles.length ? `role NOT IN (${roles.map(() => '?').join(',')})` : '1';
  database
    .prepare(
      `DELETE FROM salary_market_skill_history WHERE method_version != ? OR ${keep} OR week_start < ? OR week_start > ? OR observed_at > ?`,
    )
    .run(
      SALARY_SKILL_HISTORY_METHOD_VERSION,
      ...roles,
      oldest.toISOString().slice(0, 10),
      week,
      now.toISOString(),
    );
  database
    .prepare(`DELETE FROM salary_market_skill_history_first WHERE method_version != ? OR ${keep}`)
    .run(SALARY_SKILL_HISTORY_METHOD_VERSION, ...roles);
}
function validStoredSample(value: unknown): value is SkillSample {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SkillSample>;
  return (
    validDenominator(item.sampleSize!) &&
    Array.isArray(item.skills) &&
    item.skills.length <= 15 &&
    item.skills.every(
      (skill) =>
        skill &&
        typeof skill.name === 'string' &&
        skill.name.length > 0 &&
        skill.name.length <= 128 &&
        Number.isSafeInteger(skill.count) &&
        skill.count >= 0 &&
        skill.count <= item.sampleSize!,
    )
  );
}
function parsedPoint(payload: string, week: string): SalarySkillHistoryPoint | null {
  try {
    const data = JSON.parse(payload) as Partial<SalarySkillHistoryPoint>;
    const grades = data?.grades;
    const observedAt = data?.observedAt;
    if (
      !data ||
      !validStoredSample(data) ||
      !Array.isArray(grades) ||
      grades.length > 5 ||
      !grades.every(
        (grade) =>
          ['junior', 'middle', 'senior', 'lead', 'unknown'].includes(grade?.grade) &&
          validStoredSample(grade),
      ) ||
      !Number.isFinite(Date.parse(observedAt ?? ''))
    )
      return null;
    return { ...data, weekStart: week } as SalarySkillHistoryPoint;
  } catch {
    return null;
  }
}
/** Bounded diagnostic read: at most sixteen actual points, no future data or other methodology. */
export function readSalarySkillHistory(
  database: DatabaseSync,
  role: string,
  asOf = new Date(),
): readonly SalarySkillHistoryPoint[] {
  if (
    !database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='salary_market_skill_history' AND type='table'",
      )
      .get()
  )
    return [];
  const rows = database
    .prepare(
      `SELECT week_start, observed_at, payload FROM salary_market_skill_history
    WHERE role=? AND method_version=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 16`,
    )
    .all(role, SALARY_SKILL_HISTORY_METHOD_VERSION, asOf.toISOString()) as {
    week_start: string;
    observed_at: string;
    payload: string;
  }[];
  return rows.flatMap((row) => {
    const value = parsedPoint(row.payload, row.week_start);
    return value && value.observedAt === row.observed_at ? [value] : [];
  });
}
function baselineFor(
  history: readonly SalarySkillHistoryPoint[],
  now: Date,
  grade?: SalaryMarketGrade,
): { observedAt: string; sample: SkillSample } | undefined {
  for (const point of history) {
    const age = now.getTime() - Date.parse(point.observedAt);
    if (age < 90 * DAY_MS || age > 97 * DAY_MS) continue;
    const sample = grade ? point.grades.find((slice) => slice.grade === grade) : point;
    if (sample && validDenominator(sample.sampleSize))
      return { observedAt: point.observedAt, sample };
  }
  return undefined;
}
const percent = (count: number, total: number) => Math.round((count / total) * 10000) / 100;
function frequencyChange(
  current: SkillCount,
  currentSize: number,
  baseline: SkillSample,
): SalarySkillFrequencyChange {
  const prior = baseline.skills.find(
    (skill) =>
      skill.name === current.name &&
      Number.isSafeInteger(skill.count) &&
      skill.count >= 0 &&
      skill.count <= baseline.sampleSize,
  );
  const present = {
    name: current.name,
    currentCount: current.count,
    currentFrequency: percent(current.count, currentSize),
  };
  return prior
    ? {
        ...present,
        status: 'available',
        baselineCount: prior.count,
        baselineFrequency: percent(prior.count, baseline.sampleSize),
        changePP:
          Math.round((current.count / currentSize - prior.count / baseline.sampleSize) * 10000) /
          100,
      }
    : {
        ...present,
        status: 'baseline_skill_unavailable',
        baselineCount: null,
        baselineFrequency: null,
        changePP: null,
      };
}
function trendFor(
  sample: SkillSample,
  history: readonly SalarySkillHistoryPoint[],
  earliest: string | null,
  now: Date,
  grade?: SalaryMarketGrade,
): SalarySkillQuarterlyTrend {
  const provenance = {
    method: 'observed_catalog_skill_frequency_pp' as const,
    methodVersion: SALARY_SKILL_HISTORY_METHOD_VERSION,
    earliestActualObservation: earliest,
    current: { observedAt: now.toISOString(), sampleSize: sample.sampleSize },
  };
  const prior = baselineFor(history, now, grade);
  if (!prior) return { ...provenance, status: 'insufficient_history' };
  const baseline = { observedAt: prior.observedAt, sampleSize: prior.sample.sampleSize };
  if (
    !validDenominator(sample.sampleSize) ||
    sample.sampleSize < MIN_SALARY_MARKET_SAMPLE ||
    prior.sample.sampleSize < MIN_SALARY_MARKET_SAMPLE
  )
    return { ...provenance, status: 'insufficient_sample', baseline };
  return {
    ...provenance,
    status: 'available',
    baseline,
    skills: counts(sample).map((skill) => frequencyChange(skill, sample.sampleSize, prior.sample)),
  };
}
function enrichSnapshot(
  database: DatabaseSync,
  snapshot: SalaryMarketSnapshot,
  now: Date,
): SalaryMarketSnapshot {
  const history = readSalarySkillHistory(database, snapshot.role, now);
  const first = database
    .prepare(
      `SELECT slice,observed_at FROM salary_market_skill_history_first WHERE role=? AND method_version=? AND observed_at<=? LIMIT 6`,
    )
    .all(snapshot.role, SALARY_SKILL_HISTORY_METHOD_VERSION, now.toISOString()) as {
    slice: string;
    observed_at: string;
  }[];
  const earliest = (slice: string) => first.find((row) => row.slice === slice)?.observed_at ?? null;
  const trend = trendFor(snapshot, history, earliest('all'), now);
  return {
    ...snapshot,
    quarterlyTrend: salarySkillTrendHasChanges(trend) ? 'available' : 'unavailable',
    skillQuarterlyTrend: trend,
    gradeSlices: snapshot.gradeSlices?.map((slice) => ({
      ...slice,
      skillQuarterlyTrend: trendFor(slice, history, earliest(slice.grade), now, slice.grade),
    })),
  };
}
/** Called only inside the latest snapshot publication transaction. No fabricated historical points. */
function regionalHistorySnapshots(
  canonical: readonly SalaryMarketSnapshot[],
): SalaryMarketSnapshot[] {
  return canonical.flatMap((snapshot) => {
    const locations = new Map(
      (snapshot.locationSlices ?? [])
        .filter((slice) => SALARY_REGIONAL_LOCATIONS.includes(slice.location))
        .slice(0, 4)
        .map((slice) => [slice.location, slice]),
    );
    return [
      snapshot,
      ...[...locations.values()].map((slice) => ({
        ...snapshot,
        ...slice,
        role: salaryLocationCohortKey(snapshot.role, slice.location),
        locationSlices: undefined,
      })),
    ];
  });
}

export function accrueSalarySkillHistory(
  database: DatabaseSync,
  snapshots: readonly SalaryMarketSnapshot[],
  observedAt: Date,
): readonly SalaryMarketSnapshot[] {
  const canonical = snapshots
    .filter((snapshot) => snapshot.profession?.kind === 'b267')
    .slice(0, SALARY_MARKET_ROLE_LIMIT);
  // Select canonical100 first, then at most four regional scopes per role.
  // Distinct, versioned keys prevent global observations becoming regional history.
  const scoped = regionalHistorySnapshots(canonical);
  cleanHistory(
    database,
    scoped.map((snapshot) => snapshot.role),
    observedAt,
  );
  for (const snapshot of scoped) capturePoint(database, snapshot, observedAt);
  const globalKeys = new Set(canonical.map((snapshot) => snapshot.role));
  const enriched = new Map(
    scoped.map((snapshot) => [
      snapshot.role,
      snapshot.sampleSize > 0 || globalKeys.has(snapshot.role)
        ? enrichSnapshot(database, snapshot, observedAt)
        : snapshot,
    ]),
  );
  return snapshots.map((snapshot) => {
    const all = enriched.get(snapshot.role);
    if (!all) return snapshot;
    return {
      ...all,
      locationSlices: snapshot.locationSlices?.slice(0, 4).map((slice) => {
        const regional = enriched.get(salaryLocationCohortKey(snapshot.role, slice.location));
        return regional
          ? {
              ...slice,
              skillQuarterlyTrend: regional.skillQuarterlyTrend,
              quarterlyTrend: regional.quarterlyTrend,
              gradeSlices: regional.gradeSlices,
            }
          : slice;
      }),
    };
  });
}
