/**
 * Очередь пополнения словаря, только чтение. Название без известной функции лежит в
 * `vacancy_semantic` с кодом `other`: отдельная таблица не нужна, очередь копится сама.
 *   ssh openqareer-de-1 "cd /tmp && nice -n 19 timeout 120 node --no-warnings --input-type=module" \
 *     < scripts/golden-role-pairs/unknown-titles.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const TOP_TITLES = 100;

const db = new DatabaseSync('/var/lib/openqareer/openqareer.db', { readOnly: true });
db.exec('PRAGMA busy_timeout=2000');
const totals = db
  .prepare(
    `SELECT count(*) AS vacancies, count(DISTINCT title_key) AS titles
     FROM vacancy_semantic WHERE function_code = 'other'`,
  )
  .get();
process.stdout.write(`${JSON.stringify(totals)}\n`);
const top = db.prepare(
  `SELECT s.title_key AS key, count(*) AS vacancies, p.sample_title AS title, p.parsed_by AS parsedBy
   FROM vacancy_semantic s LEFT JOIN title_parse p ON p.title_key = s.title_key
   WHERE s.function_code = 'other'
   GROUP BY s.title_key ORDER BY vacancies DESC LIMIT ?`,
);
for (const row of top.all(TOP_TITLES)) {
  process.stdout.write(`${row.vacancies}\t${row.parsedBy}\t${row.title}\n`);
}
