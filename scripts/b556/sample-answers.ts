/**
 * B556: sends failed prod postings to the bulk model with the production prompt and stores the raw
 * answers for offline replay. Paid: stops at the call limit. Usage:
 * npx tsx scripts/b556/sample-answers.ts <jobs.json> <answers.json> <limit>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractVacancyRequirementsWithFallback } from '../../server/domain/vacancyRequirements.js';
import { minimizeModelText } from '../../server/providers/modelInputPrivacy.js';

const env = Object.fromEntries(readFileSync(join(homedir(), '.openqareer/openqareer.env'), 'utf8').split('\n')
  .map((line) => line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/u)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/gu, '')]));
const key = env.OPENQAREER_OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY missing');
const [jobsPath, outPath, limitArg] = process.argv.slice(2);
const jobs = (JSON.parse(readFileSync(jobsPath, 'utf8')) as { e: string | null; vacancyId: string; description?: string }[])
  .filter((job) => job.e === 'requirements_model_invalid' && job.description?.trim()).slice(0, Number(limitArg));
const out: { vacancyId: string; description: string; answer: string; costUsd: number }[] = [];
let spent = 0;
for (const job of jobs) {
  await extractVacancyRequirementsWithFallback({ vacancyId: job.vacancyId, description: job.description }, { extract: async ({ description, instructions }) => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', max_tokens: 4096, reasoning: { enabled: false }, provider: { order: ["streamlake/fp8", "deepinfra/fp8"], allow_fallbacks: true }, usage: { include: true },
        messages: [{ role: 'system', content: instructions }, { role: 'user', content: minimizeModelText(description) }] }),
    });
    const body = await response.json() as { choices?: { message: { content: string } }[]; usage?: { cost?: number } };
    const answer = body.choices?.[0]?.message.content ?? '';
    spent += body.usage?.cost ?? 0;
    out.push({ vacancyId: job.vacancyId, description: job.description!, answer, costUsd: body.usage?.cost ?? 0 });
    return answer;
  } });
  if (spent > 0.5) break;
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`calls=${out.length} spentUsd=${spent.toFixed(5)}`);
