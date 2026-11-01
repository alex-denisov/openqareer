import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractVacancyRequirementsWithFallback } from './vacancyRequirements';

// Owner audit 01.11, V04 CTO Первый Бит: 88 % on 4 requirements, blind review found 9.
const description = readFileSync(new URL('./__fixtures__/vacancy-audit-V04.txt', import.meta.url), 'utf8');
const lines = (heading: string) =>
  description.split(`${heading}:`)[1]!.split('\n\n')[1]!.split('\n').map((line) => line.replace(/^- /u, '').trim());
const entry = (quote: string) => ({ text: quote, sourceQuote: quote, origin: 'structural', label: quote.split(' ').slice(0, 3).join(' '), kind: 'experience' });
const answer = (quotes: readonly string[]) => JSON.stringify({ requirements: quotes.map(entry) });

describe('extractor covers every distinct ask of a long vacancy (02.11 audit)', () => {
  it('asks again when a long text gave fewer than 6 requirements and keeps the fuller answer', async () => {
    const asks: string[] = [];
    const requirements = lines('Требования');
    const duties = lines('Обязанности');
    const model = {
      extract: async ({ instructions }: { readonly instructions: string }) => {
        asks.push(instructions);
        return answer(asks.length === 1 ? requirements : [...requirements, ...duties]);
      },
    };
    const result = await extractVacancyRequirementsWithFallback({ vacancyId: 'V04', description }, model);
    expect(requirements).toHaveLength(4);
    expect(result.requirements).toHaveLength(9);
    expect(asks).toHaveLength(2);
    expect(asks[1]).toContain('found only 4 requirements');
  });

  it('the instructions name duties and hard industry or domain experience as asks', async () => {
    let instructions = '';
    await extractVacancyRequirementsWithFallback({ vacancyId: 'V04', description }, {
      extract: async (request: { readonly instructions: string }) => { instructions = request.instructions; return answer(lines('Требования')); },
    });
    expect(instructions).toContain('every distinct ask');
    expect(instructions).toContain('each duty the role must perform');
    expect(instructions).toContain('industry or domain experience');
  });

  it('a short text with few requirements is asked once', async () => {
    let calls = 0;
    const short = 'Требования:\n\n- Опыт SQL\n- Опыт Python';
    await extractVacancyRequirementsWithFallback({ vacancyId: 's', description: short }, {
      extract: async () => { calls += 1; return answer(['Опыт SQL', 'Опыт Python']); },
    });
    expect(calls).toBe(1);
  });
});
