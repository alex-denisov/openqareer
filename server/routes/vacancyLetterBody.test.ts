import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { COVER_LETTER_BUDGET_MS } from '../providers/coverLetterWriter';
import { writeCoverLetterBody, type LetterWritingRequest } from './vacancyLetterBody';

const letter: LetterWritingRequest = {
  vacancy: { title: 'CTO', requiredSkills: [] },
  facts: [],
  workplaces: [],
  language: 'ru',
  tone: 'executive',
  rankingContext: undefined,
  targetCompany: false,
  contextMs: 0,
};

const request = { log: { warn: vi.fn() } } as unknown as FastifyRequest;
const hanging = { writeCoverLetter: () => new Promise<never>(() => {}) };

describe('writeCoverLetterBody: the time the candidate waits', () => {
  it('holds the agreed 24 s and hands over to the template', async () => {
    vi.useFakeTimers();
    try {
      const written = writeCoverLetterBody(hanging, request, letter);
      await vi.advanceTimersByTimeAsync(COVER_LETTER_BUDGET_MS);
      await expect(written).resolves.toEqual({});
      expect(COVER_LETTER_BUDGET_MS).toBe(24_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the context assembly the candidate has already waited for', async () => {
    vi.useFakeTimers();
    try {
      const written = writeCoverLetterBody(hanging, request, { ...letter, contextMs: COVER_LETTER_BUDGET_MS - 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(written).resolves.toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
