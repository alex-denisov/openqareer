/**
 * B568: measures how the interview question bank follows from the pool.
 * Read-only. Run on the host with the production database:
 *   npx esbuild scripts/measure-interview-evidence.ts --bundle --platform=node --format=cjs \
 *     --loader:.json=json --outfile=/tmp/measure-interview.cjs
 *   sudo nice node /tmp/measure-interview.cjs /var/lib/openqareer/openqareer.db > evidence.json
 * Prints the evidence file to stdout and the per-profession distribution to stderr.
 */
import { DatabaseSync } from 'node:sqlite';
import { classifySalaryMarketTitle } from '../server/salaryMarket/salaryMarketClassification';
import { INTERVIEW_PROFESSIONS } from '../shared/interviewQuestions';
import type { InterviewEvidence } from '../shared/interviewQuestions/types';

const WINDOW_DAYS = 90;
/** A description shorter than this is a teaser, not a requirements text. */
const MIN_DESCRIPTION_CHARS = 300;
/** Set from the measurement on 27.10.2026 (see ticket B568). */
const MIN_DESCRIBED = 100;

interface PoolRow {
  readonly source_id: string;
  readonly payload: string;
}

interface Tally {
  readonly vacancies: Map<string, number>;
  readonly described: Map<string, number>;
  readonly matches: Map<string, Map<string, number>>;
}

function topicRules(): Map<string, { id: string; pattern: RegExp }[]> {
  return new Map(
    INTERVIEW_PROFESSIONS.map((profession) => [
      profession.slug,
      profession.questions.flatMap((question) =>
        question.topic
          ? [{ id: question.id, pattern: new RegExp(question.topic.pattern, 'iu') }]
          : [],
      ),
    ]),
  );
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function tally(databasePath: string, now: Date): Tally {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const rules = topicRules();
  const result: Tally = { vacancies: new Map(), described: new Map(), matches: new Map() };
  const rows = database
    .prepare(
      'SELECT source_id, payload FROM vacancy_pool WHERE expired_at IS NULL AND published_at >= ?',
    )
    .iterate(cutoff) as Iterable<PoolRow>;
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { title?: string; description?: string };
    if (typeof payload.title !== 'string') continue;
    const role = classifySalaryMarketTitle(payload.title, null);
    if (role.profession.kind !== 'b267') continue;
    bump(result.vacancies, role.role);
    const text = typeof payload.description === 'string' ? payload.description : '';
    if (text.length < MIN_DESCRIPTION_CHARS) continue;
    bump(result.described, role.role);
    const counts = result.matches.get(role.role) ?? new Map<string, number>();
    for (const rule of rules.get(role.role) ?? [])
      if (rule.pattern.test(text)) bump(counts, rule.id);
    result.matches.set(role.role, counts);
  }
  database.close();
  return result;
}

function measure(databasePath: string, now: Date): InterviewEvidence {
  const { vacancies, described, matches } = tally(databasePath, now);
  const distribution = [...described.entries()].sort((a, b) => b[1] - a[1]);
  process.stderr.write(`${JSON.stringify({ roles: distribution.length, distribution })}\n`);
  return {
    measuredAt: now.toISOString().slice(0, 10),
    windowDays: WINDOW_DAYS,
    minDescribed: MIN_DESCRIBED,
    professions: Object.fromEntries(
      INTERVIEW_PROFESSIONS.map((profession) => [
        profession.slug,
        {
          vacancies: vacancies.get(profession.slug) ?? 0,
          described: described.get(profession.slug) ?? 0,
          topics: Object.fromEntries(matches.get(profession.slug) ?? []),
        },
      ]),
    ),
  };
}

const databasePath = process.argv[2];
if (!databasePath) {
  process.stderr.write('usage: measure-interview-evidence <database>\n');
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(measure(databasePath, new Date()), null, 2)}\n`);
