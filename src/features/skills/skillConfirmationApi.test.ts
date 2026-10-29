import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySkillQuizAttempt,
  generateSkillQuiz,
  getSkillConfirmations,
  skillConfirmationErrorText,
  submitSkillQuiz,
} from './skillConfirmationApi';
import { CoachApiError } from '../coach/apiClient';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('skill confirmation API', () => {
  it('reads the confirmations list', async () => {
    const calls = stubFetch(200, { data: { passingScorePercent: 80, skills: [] } });
    await expect(getSkillConfirmations()).resolves.toEqual({ passingScorePercent: 80, skills: [] });
    expect(calls[0].url).toBe('/api/v1/candidate/skill-confirmations');
  });

  it('generates a quiz for a skill and level', async () => {
    const calls = stubFetch(201, { data: { attemptId: 'a1', questions: [] } });
    await generateSkillQuiz({ skillName: 'SQL', level: 'middle' });
    expect(calls[0].url).toBe('/api/v1/candidate/skill-quiz/generate');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ skillName: 'SQL', level: 'middle' });
  });

  it('submits answers to the attempt', async () => {
    const calls = stubFetch(200, { data: { attemptId: 'a1', result: {} } });
    await submitSkillQuiz({ attemptId: 'a1', answers: { q1: 2 } });
    expect(calls[0].url).toBe('/api/v1/candidate/skill-quiz/attempts/a1/submit');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ answers: { q1: 2 } });
  });

  it('applies the attempt with the idempotency key', async () => {
    const calls = stubFetch(201, { data: { commandId: 'c1' } });
    await expect(applySkillQuizAttempt({ attemptId: 'a1', idempotencyKey: 'k1' })).resolves.toEqual(
      { commandId: 'c1' },
    );
    expect(calls[0].url).toBe('/api/v1/candidate/skill-quiz/attempts/a1/apply');
    expect(calls[0].init?.headers).toMatchObject({ 'Idempotency-Key': 'k1' });
  });

  it('turns a server error code into a human sentence, never the raw message', async () => {
    stubFetch(429, {
      error: { code: 'skill_quiz_attempts_exhausted', message: 'RAW_SERVER_TEXT' },
    });
    const error = await generateSkillQuiz({ skillName: 'SQL', level: 'junior' }).catch((e) => e);
    expect(error).toBeInstanceOf(CoachApiError);
    expect(skillConfirmationErrorText(error)).toContain('Две попытки за сутки');
    expect(skillConfirmationErrorText(error)).not.toContain('RAW_SERVER_TEXT');
    expect(skillConfirmationErrorText(new Error('boom'))).not.toContain('boom');
  });
});
