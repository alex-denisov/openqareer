import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySkillQuizResult } from './careerCommandApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apply skill quiz result API', () => {
  it('sends the quiz answers and stable idempotency key to the server', async () => {
    const responseData = {
      commandId: 'command-1',
      command: { commandId: 'command-1' },
      result: { quizId: 'typescript', statusLabel: 'подтверждён' },
      fact: { skillName: 'TypeScript', status: 'подтверждён', source: 'hh.ru', date: '2026-10-06' },
    };
    let request: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        request = { url: String(input), init };
        return new Response(JSON.stringify({ data: responseData }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    await expect(
      applySkillQuizResult({
        quizId: 'typescript',
        skillName: 'TypeScript',
        answers: { 'ts-1': 1 },
        idempotencyKey: 'stable-key',
      }),
    ).resolves.toMatchObject({ commandId: 'command-1' });

    expect(request?.url).toBe('/api/v1/candidate/skill-quiz/apply');
    expect(request?.init?.headers).toMatchObject({ 'Idempotency-Key': 'stable-key' });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      quizId: 'typescript',
      skillName: 'TypeScript',
      answers: { 'ts-1': 1 },
    });
  });
});
