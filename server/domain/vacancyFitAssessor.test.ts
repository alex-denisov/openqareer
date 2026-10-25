import { describe, expect, it, vi } from 'vitest';
import { createVacancyFitAssessor } from './vacancyFitAssessor';

describe('bounded candidate-data assessor adapter', () => {
  it('uses pinned bulk client candidate path and parses exact evidence', async () => {
    const complete = vi.fn().mockResolvedValue({ content: JSON.stringify({ assessments: [{ requirementId: 'r', status: 'matched', evidence: [{ factId: 'f', quote: 'TypeScript' }] }] }) });
    const assessor = createVacancyFitAssessor({ complete }, 'run-1');
    const requirements = [{ id: 'r', text: 'TypeScript', sourceQuote: 'TypeScript', origin: 'explicit' as const, kind: 'experience' as const, importance: 'high' as const, hard: true, stopFactor: false }];
    expect((await assessor.assess({ requirements, facts: [] }))[0].evidence[0].quote).toBe('TypeScript');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', dataClass: 'candidate', task: 'vacancy-fit', maxTokens: 4096 }));
  });
  it('rejects invented output shape instead of trusting unstructured content', async () => {
    const assessor = createVacancyFitAssessor({ complete: vi.fn().mockResolvedValue({ content: '{"score":95}' }) }, 'run-1');
    await expect(assessor.assess({ requirements: [], facts: [] })).rejects.toThrow('invalid vacancy fit assessment');
  });
  it('reads assessments wrapped in a markdown fence (1 of 12 local deepseek answers, B562-r)', async () => {
    const body = JSON.stringify({ assessments: [{ requirementId: 'r', status: 'unknown', evidence: [] }] });
    const assessor = createVacancyFitAssessor({ complete: vi.fn().mockResolvedValue({ content: '```json\n' + body + '\n```' }) }, 'run-1');
    const requirements = [{ id: 'r', text: 'Go', sourceQuote: 'Go', origin: 'explicit' as const, kind: 'other' as const, importance: 'high' as const, hard: true, stopFactor: false }];
    expect(await assessor.assess({ requirements, facts: [] })).toEqual([{ requirementId: 'r', status: 'unknown', evidence: [] }]);
  });
});
