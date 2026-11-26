import { describe, expect, it, vi } from 'vitest';
import { BulkInputTooLarge } from '../providers/bulkLlmClient';
import { createVacancyFitAssessor } from './vacancyFitAssessor';

const requirement = {
  id: 'r',
  text: 'Бюджет ИТ',
  sourceQuote: 'Бюджет ИТ',
  origin: 'explicit' as const,
  kind: 'experience' as const,
  importance: 'high' as const,
  hard: true,
  stopFactor: false,
};
const facts = Array.from({ length: 400 }, (_, index) => ({
  id: `profile:achievement:${index}`,
  candidateId: 'c',
  kind: 'fact' as const,
  status: 'confirmed' as const,
  statement: `Достижение ${index}: ${'управление бюджетом и командой '.repeat(4)}`,
  sourceMessageIds: ['m'],
  sensitive: false,
}));
const answer = {
  content: JSON.stringify({
    assessments: [{ requirementId: 'r', status: 'unknown', evidence: [] }],
  }),
};
const prefixBytes = (call: unknown[]) => Buffer.byteLength((call[0] as { prefix: string }).prefix);

describe('B757: a fit request over the per-request ceiling', () => {
  it('is asked again with fewer facts, and the smaller request is answered', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new BulkInputTooLarge())
      .mockResolvedValueOnce(answer);
    const rows = await createVacancyFitAssessor({ complete }, 'run').assess({
      requirements: [requirement],
      facts,
    });
    expect(rows).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(prefixBytes(complete.mock.calls[1]!)).toBeLessThan(
      prefixBytes(complete.mock.calls[0]!) * 0.7,
    );
  });

  it('that does not fit even with the smallest set of facts is a final refusal, asked a bounded number of times', async () => {
    const complete = vi.fn().mockRejectedValue(new BulkInputTooLarge());
    const error = await createVacancyFitAssessor({ complete }, 'run')
      .assess({ requirements: [requirement], facts })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BulkInputTooLarge);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('any other failure is not retried here', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      createVacancyFitAssessor({ complete }, 'run').assess({ requirements: [requirement], facts }),
    ).rejects.toThrow('boom');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
