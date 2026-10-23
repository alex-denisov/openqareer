/**
 * B556: replays the B521 model answers (18.10 trial, no new calls) through the current quote
 * validator and prints the failure share. Usage: npx tsx scripts/b556/replay-quotes.ts
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractVacancyRequirementsWithFallback, type ModelAnswerIssue } from '../../server/domain/vacancyRequirements.js';

const dir = join(homedir(), '.openqareer/research/B521');
const sample = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8')) as { id: string; description?: string }[];
const trial = JSON.parse(readFileSync(join(dir, 'trial.json'), 'utf8')) as { results: { vacancyId: string; model: string; requirements?: { text: string; quote: string; origin: string }[] }[] };
const byId = new Map(sample.map((row) => [row.id, row]));
const totals: Record<string, { answers: number; invalid: number; entries: number; quote: number }> = {};
for (const result of trial.results) {
  const row = byId.get(result.vacancyId);
  if (!row?.description || !result.requirements) continue;
  const answer = JSON.stringify({ requirements: result.requirements.map((entry) => ({ text: entry.text, sourceQuote: entry.quote, origin: entry.origin, label: 'x', kind: 'skill' })) });
  const issues: ModelAnswerIssue[] = [];
  const quotes = result.requirements.map((entry) => entry.quote);
  const out = await extractVacancyRequirementsWithFallback({ vacancyId: row.id, description: row.description }, { extract: async () => answer }, (issue) => issues.push(issue));
  const total = (totals[result.model] ??= { answers: 0, invalid: 0, entries: 0, quote: 0 });
  total.answers += 1;
  total.entries += quotes.length;
  total.quote += issues.filter((issue) => issue === 'quote').length;
  if (out.fallbackStatus === 'invalid') total.invalid += 1;
}
console.log(JSON.stringify(totals, null, 1));
