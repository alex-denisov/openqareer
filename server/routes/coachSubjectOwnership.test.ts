import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';
import { buildCoachSubjectContext } from './coachSubjectContext';
import type { RouteDeps } from './deps';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** B746: панель B640 передаёт объект экрана; сервер строит контекст только по своему объекту. */
async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const own = h.candidates.createApplication(h.candidateIds['flagged.test'], {
    stage: 'interview',
    manualVacancy: {
      title: 'Технический директор',
      company: 'Intouch Group',
      url: 'https://example.test/cto',
      source: 'other',
    },
  });
  const interview = h.candidates.createApplicationInterview(
    h.candidateIds['flagged.test'],
    own.id,
    {
      round: 1,
      scheduledAt: '2026-12-01T12:00:00.000Z',
    },
  );
  const turn = (user: HarnessUser, subject: unknown) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn?delivery=receipt',
      headers: {
        authorization: `Bearer ${h.tokens[user]}`,
        'idempotency-key': crypto.randomUUID(),
      },
      payload: {
        messageId: crypto.randomUUID(),
        content: 'Что меня спросят на этом интервью?',
        stage: 'responses',
        subject,
      },
    });
  return { ...h, own, interview, turn };
}

describe('subject консультанта принадлежит кандидату (B746)', () => {
  it('свой отклик: контекст называет роль и компанию', async () => {
    const { candidates, candidateIds, own } = await setup();
    const deps = { candidateStore: candidates } as unknown as RouteDeps;
    const context = await buildCoachSubjectContext(deps, candidateIds['flagged.test'], {
      kind: 'application',
      id: own.id,
    });
    expect(context).toContain('Технический директор (Intouch Group)');
  });

  it('чужой отклик и чужое интервью: контекст не строится — 404, не 500', async () => {
    const { own, interview, turn } = await setup();
    for (const subject of [
      { kind: 'application', id: own.id },
      { kind: 'interview', id: interview.id },
    ]) {
      const response = await turn('other.test', subject);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('subject_not_found');
    }
  });

  it('несуществующий id отклика — 404, не 500', async () => {
    const { turn } = await setup();
    const response = await turn('flagged.test', { kind: 'application', id: 'missing' });
    expect(response.statusCode).toBe(404);
  });
});
