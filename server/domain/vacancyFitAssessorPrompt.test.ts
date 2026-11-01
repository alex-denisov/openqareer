import { describe, expect, it } from 'vitest';
import type { BulkLlmInput } from '../providers/bulkLlmClient';
import { createVacancyFitAssessor } from './vacancyFitAssessor';
import type { VacancyFitInput } from './vacancyFit';

async function sentPrompt(): Promise<string> {
  let prefix = '';
  const assessor = createVacancyFitAssessor(
    {
      complete: async (request: BulkLlmInput) => {
        prefix = request.prefix;
        return { content: '{"assessments":[]}' };
      },
    },
    'run',
  );
  await assessor.assess({ facts: [], requirements: [] } as unknown as VacancyFitInput);
  return prefix;
}

describe('fit prompt rules from the .app run 3 (02.11)', () => {
  it('LIYAN McATEER: close synonyms and any shown element of a listed requirement are evidence', async () => {
    const prompt = await sentPrompt();
    expect(prompt).toContain('"P&L" meets "financial management"');
    expect(prompt).toContain('"transformation" meets "change management"');
    expect(prompt).toContain(
      'when the facts show some of its elements, answer partial, never unknown',
    );
  });

  it('Астрал: evidence that only borders on the requirement is partial at most', async () => {
    const prompt = await sentPrompt();
    expect(prompt).toContain('Indirect evidence shows at most partial');
    expect(prompt).toContain('CSAT or SLA results do not show work with product teams');
  });
});
