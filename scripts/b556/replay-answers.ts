/**
 * B556: replays stored raw model answers through the current validator (free). Prints the invalid
 * share and dumps every rejected quote with the description for classification.
 * Usage: npx tsx scripts/b556/replay-answers.ts <answers.json> [rejected.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { extractVacancyRequirementsWithFallback, type ModelAnswerIssue } from '../../server/domain/vacancyRequirements.js';

const answers = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { vacancyId: string; description: string; answer: string }[];
let invalid = 0;
const issues: Record<string, number> = {};
const rejected: { vacancyId: string; quotes: string[] }[] = [];
for (const row of answers) {
  const seen: ModelAnswerIssue[] = [];
  const result = await extractVacancyRequirementsWithFallback({ vacancyId: row.vacancyId, description: row.description }, { extract: async () => row.answer }, (issue) => seen.push(issue));
  for (const issue of seen) issues[issue] = (issues[issue] ?? 0) + 1;
  if (result.fallbackStatus === 'invalid') { invalid += 1; rejected.push({ vacancyId: row.vacancyId, quotes: [row.answer.slice(0, 3000)] }); }
}
console.log(`answers=${answers.length} invalid=${invalid} share=${Math.round((invalid / answers.length) * 1000) / 10}%`, issues);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(rejected, null, 1));
