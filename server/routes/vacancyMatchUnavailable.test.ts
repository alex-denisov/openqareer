import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { VacancyMatchUnavailable } from '../vacancies/vacancyMatchReader';
import { registerErrorHandler } from './runtime';

/** PRB-041 (prod 04.11): one timed-out pool read answered 500 to all eight waiting requests. */
describe('a pool read that could not finish', () => {
  const lines: Array<Record<string, unknown>> = [];
  const app = Fastify({
    logger: {
      stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
    },
  });
  registerErrorHandler(app);
  app.get('/busy', async () => {
    throw new VacancyMatchUnavailable('vacancy_match_timeout', 12_000, 3);
  });
  app.get('/broken', async () => {
    throw new Error('vacancy_match_query_failed');
  });

  afterEach(() => void lines.splice(0));

  it('answers a repeatable 503 and logs the failure with its numbers', async () => {
    const response = await app.inject({ method: 'GET', url: '/busy' });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json().error).toMatchObject({ code: 'vacancy_match_busy', retryable: true });
    expect(response.json().error.message).not.toMatch(/vacancy_match|SQL|timeout/u);
    expect(lines.find((line) => line.msg === 'vacancy-match-unavailable')).toMatchObject({
      reason: 'vacancy_match_timeout',
      waitedMs: 12_000,
      pendingReads: 3,
    });
  });

  it('leaves any other failure a 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/broken' });
    expect(response.statusCode).toBe(500);
  });
});
