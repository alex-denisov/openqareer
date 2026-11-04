import { describe, expect, it, vi } from 'vitest';
import { assessmentFailureLine, createVacancyFitAssessor } from './vacancyFitAssessor';

describe('bounded candidate-data assessor adapter', () => {
  it('uses pinned bulk client candidate path and parses exact evidence', async () => {
    const complete = vi.fn().mockResolvedValue({ content: JSON.stringify({ assessments: [{ requirementId: 'r', status: 'matched', evidence: [{ factId: 'f', quote: 'TypeScript' }] }] }) });
    const assessor = createVacancyFitAssessor({ complete }, 'run-1');
    const requirements = [{ id: 'r', text: 'TypeScript', sourceQuote: 'TypeScript', origin: 'explicit' as const, kind: 'experience' as const, importance: 'high' as const, hard: true, stopFactor: false }];
    expect((await assessor.assess({ requirements, facts: [] }))[0].evidence[0].quote).toBe('TypeScript');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', dataClass: 'candidate', task: 'vacancy-fit', maxTokens: 4096 }));
  });
  it('sends the same prompt for the same fit input, so a re-run is asked the same question (02.11)', async () => {
    const complete = vi.fn().mockResolvedValue({ content: JSON.stringify({ assessments: [] }) });
    const assessor = createVacancyFitAssessor({ complete }, 'run-1');
    const requirements = [{ id: 'r', text: 'TypeScript', sourceQuote: 'TypeScript', origin: 'explicit' as const, kind: 'experience' as const, importance: 'high' as const, hard: true, stopFactor: false }];
    const facts = [{ id: 'b', candidateId: 'c', kind: 'fact' as const, status: 'confirmed' as const, statement: 'Node services', sourceMessageIds: ['m'], sensitive: false },
      { id: 'a', candidateId: 'c', kind: 'fact' as const, status: 'confirmed' as const, statement: 'TypeScript', sourceMessageIds: ['m'], sensitive: false }];
    await assessor.assess({ requirements, facts }).catch(() => undefined);
    await assessor.assess({ requirements, facts }).catch(() => undefined);
    const [first, second] = complete.mock.calls.map(([request]) => ({ prefix: request.prefix, input: request.input }));
    expect(second).toEqual(first);
  });
  it('rejects invented output shape instead of trusting unstructured content', async () => {
    const assessor = createVacancyFitAssessor({ complete: vi.fn().mockResolvedValue({ content: '{"score":95}' }) }, 'run-1');
    await expect(assessor.assess({ requirements: [], facts: [] })).rejects.toThrow('invalid vacancy fit assessment');
  });
  it('reads assessments wrapped in a markdown fence (1 of 12 local deepseek answers, B562-r)', async () => {
    const body = JSON.stringify({
      assessments: [{ requirementId: 'r', status: 'unknown', evidence: [] }],
    });
    const assessor = createVacancyFitAssessor(
      { complete: vi.fn().mockResolvedValue({ content: '```json\n' + body + '\n```' }) },
      'run-1',
    );
    const requirements = [
      {
        id: 'r',
        text: 'Go',
        sourceQuote: 'Go',
        origin: 'explicit' as const,
        kind: 'other' as const,
        importance: 'high' as const,
        hard: true,
        stopFactor: false,
      },
    ];
    expect(await assessor.assess({ requirements, facts: [] })).toEqual([
      { requirementId: 'r', status: 'unknown', evidence: [] },
    ]);
  });
});

describe('one bad entry does not lose the whole answer (04.11)', () => {
  const requirements = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id, sourceQuote: id, origin: 'explicit', importance: 'high', kind: 'other', hard: false, stopFactor: false })) as never;
  const answer = (content: unknown) => createVacancyFitAssessor({ complete: async () => ({ content: typeof content === 'string' ? content : JSON.stringify(content) }) }, 'run').assess({ requirements, facts: [] });

  it('takes `statement` for a missing quote: the evaluation still checks it against the fact', async () => {
    const rows = await answer({ assessments: [{ requirementId: 'a', status: 'matched', evidence: [{ factId: 'f', statement: 'Led teams' }] }] });
    expect(rows).toEqual([{ requirementId: 'a', status: 'matched', evidence: [{ factId: 'f', quote: 'Led teams' }] }]);
  });
  it('drops a bad evidence entry and a bad row, keeps the rest', async () => {
    const rows = await answer({ assessments: [
      { requirementId: 'a', status: 'matched', evidence: [{ factId: 'f' }, { factId: 'f', quote: 'Led teams' }] },
      { requirementId: 'b', status: 'yes', evidence: [] },
      { status: 'matched', evidence: [] },
      { requirementId: 'c', status: 'unknown' },
    ] });
    expect(rows).toEqual([
      { requirementId: 'a', status: 'matched', evidence: [{ factId: 'f', quote: 'Led teams' }] },
      { requirementId: 'c', status: 'unknown', evidence: [] },
    ]);
  });
  it('an answer with no usable row is invalid and moves down the chain', async () => {
    let accepted: boolean | undefined;
    const assessor = createVacancyFitAssessor({ complete: async (input) => {
      const content = JSON.stringify({ assessments: [{ status: 'matched' }] });
      accepted = input.accept?.(content);
      return { content };
    } }, 'run');
    await expect(assessor.assess({ requirements, facts: [] })).rejects.toThrow('invalid vacancy fit assessment');
    expect(accepted).toBe(false);
  });
});

describe('the journal says why a call failed (04.11)', () => {
  it('names the failure and never prints the answer a JSON error quotes', () => {
    let error: unknown;
    try { JSON.parse('{"quote": "PRIVATE профиль'); } catch (caught) { error = caught; }
    const line = assessmentFailureLine('v1', error);
    expect(line).toBe('fit-assessment-failed vacancy=v1 kind=invalid_json');
    expect(line).not.toContain('PRIVATE');
  });
  it('keeps the provider status and masks a key', () => {
    const line = assessmentFailureLine('v1', new Error(`status 429: quota key=${'x'.repeat(40)} ${'y'.repeat(400)}`));
    expect(line).toContain('kind=call_failed detail=status 429: quota');
    expect(line).not.toContain('x'.repeat(40));
    expect(line.length).toBeLessThan(220);
  });
});

