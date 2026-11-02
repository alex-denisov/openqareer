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

  it('owner audit 02.11: partial is the same work at a smaller scope; an adjacent area is unknown', async () => {
    const prompt = await sentPrompt();
    expect(prompt).toContain('Partial: the same kind of work at a smaller scope, fewer years, or some of the listed elements');
    expect(prompt).toContain('A fact about an adjacent area is unknown, not partial');
    expect(prompt).toContain('AV in classrooms does not show TV broadcast signal chains');
    expect(prompt).toContain('a general skill ("Linux", "IT Infrastructure Management") does not show a specific technology');
  });
});
