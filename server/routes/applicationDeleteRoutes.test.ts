import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateStore } from '../data/candidateStore';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const APPS = '/api/v1/candidate/applications';
const B640 = '/api/v1/candidate/b640';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const send = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    user: HarnessUser,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: { authorization: `Bearer ${h.tokens[user]}`, origin: 'http://localhost:3000' },
    });
  const application = (user: HarnessUser) =>
    h.candidates.createApplication(h.candidateIds[user], {
      stage: 'interview',
      manualVacancy: {
        title: 'CTO',
        company: `Co ${randomUUID()}`,
        url: `https://example.test/${randomUUID()}`,
        source: 'other',
      },
    });
  const sql = <T>(query: string, ...params: Array<string | number>): T[] => {
    const database = new DatabaseSync(h.databasePath);
    try {
      return database.prepare(query).all(...params) as unknown as T[];
    } finally {
      database.close();
    }
  };
  const run = (query: string, ...params: Array<string | number>) => {
    const database = new DatabaseSync(h.databasePath);
    try {
      database.prepare(query).run(...params);
    } finally {
      database.close();
    }
  };
  return { ...h, send, application, sql, run };
}

describe('DELETE оффера: кандидат убирает оффер, внесённый по ошибке', () => {
  it('удаляет оффер и выбор по нему; новый оффер на том же отклике начинается с чистого выбора', async () => {
    const { send, application, candidates, candidateIds } = await setup();
    const own = application('flagged.test');
    candidates.putApplicationOffer(
      candidateIds['flagged.test'],
      own.id,
      { baseSalary: 1, currency: 'RUB' },
      null,
    );
    await send('PUT', `${B640}/offers/${own.id}/decision`, 'flagged.test', {
      decision: 'accepted',
    });
    await send('PUT', `${B640}/offers/${own.id}/tax`, 'flagged.test', { taxPercent: 13 });

    const deleted = await send('DELETE', `${B640}/offers/${own.id}`, 'flagged.test');

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toEqual({ applicationId: own.id, deleted: true });
    expect((await send('GET', `${B640}/offers`, 'flagged.test')).json().data).toEqual([]);
    candidates.putApplicationOffer(
      candidateIds['flagged.test'],
      own.id,
      { baseSalary: 2, currency: 'RUB' },
      null,
    );
    const fresh = (await send('GET', `${B640}/offers`, 'flagged.test')).json().data[0];
    expect(fresh).toMatchObject({ decision: null, taxPercent: null });
  });

  it('чужой и несуществующий оффер — 404, чужой остаётся на месте', async () => {
    const { send, application, candidates, candidateIds } = await setup();
    const foreign = application('other.test');
    candidates.putApplicationOffer(candidateIds['other.test'], foreign.id, { baseSalary: 1 }, null);
    const noOffer = application('flagged.test');

    expect((await send('DELETE', `${B640}/offers/${foreign.id}`, 'flagged.test')).statusCode).toBe(
      404,
    );
    expect((await send('DELETE', `${B640}/offers/${noOffer.id}`, 'flagged.test')).statusCode).toBe(
      404,
    );
    expect(
      (await send('DELETE', `${B640}/offers/${randomUUID()}`, 'flagged.test')).statusCode,
    ).toBe(404);
    expect((await send('GET', `${B640}/offers`, 'other.test')).json().data).toHaveLength(1);
  });

  it('без флага B640 маршрута нет', async () => {
    const { send, application, candidates, candidateIds } = await setup();
    const own = application('plain.test');
    candidates.putApplicationOffer(candidateIds['plain.test'], own.id, { baseSalary: 1 }, null);
    expect((await send('DELETE', `${B640}/offers/${own.id}`, 'plain.test')).statusCode).toBe(404);
    expect(candidates.getApplicationOffer(candidateIds['plain.test'], own.id)).not.toBeNull();
  });
});

describe('DELETE интервью: тестовое или ошибочное интервью снимается с напоминанием', () => {
  const inWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

  it('удаляет интервью и его неотправленное напоминание', async () => {
    const { send, application, sql, run, candidateIds } = await setup();
    const own = application('flagged.test');
    const created = await send('POST', `${APPS}/${own.id}/interviews`, 'flagged.test', {
      round: 1,
      scheduledAt: inWeek(),
    });
    const interviewId = created.json().data.id as string;
    const [reminder] = sql<{ id: string }>(
      `SELECT id FROM candidate_notifications WHERE source_type = 'interview' AND source_id = ?`,
      interviewId,
    );
    expect(reminder).toBeDefined();
    run(
      `INSERT INTO candidate_notification_deliveries
        (notification_id, candidate_id, channel, status, attempts, next_attempt_at, updated_at)
       VALUES (?, ?, 'email', 'pending', 0, 'now', 'now')`,
      reminder!.id,
      candidateIds['flagged.test'],
    );

    const deleted = await send(
      'DELETE',
      `${APPS}/${own.id}/interviews/${interviewId}`,
      'flagged.test',
    );

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toEqual({ interviewId, deleted: true });
    expect(sql(`SELECT id FROM application_interviews WHERE id = ?`, interviewId)).toEqual([]);
    expect(sql(`SELECT id FROM candidate_notifications WHERE source_id = ?`, interviewId)).toEqual(
      [],
    );
    expect(
      sql(
        `SELECT 1 FROM candidate_notification_deliveries WHERE notification_id = ?`,
        reminder!.id,
      ),
    ).toEqual([]);
  });

  it('отправленное напоминание остаётся в истории', async () => {
    const { send, application, sql, run, candidateIds } = await setup();
    const own = application('flagged.test');
    const created = await send('POST', `${APPS}/${own.id}/interviews`, 'flagged.test', {
      round: 1,
      scheduledAt: inWeek(),
    });
    const interviewId = created.json().data.id as string;
    const [reminder] = sql<{ id: string }>(
      `SELECT id FROM candidate_notifications WHERE source_id = ?`,
      interviewId,
    );
    run(
      `INSERT INTO candidate_notification_deliveries
        (notification_id, candidate_id, channel, status, attempts, next_attempt_at, updated_at)
       VALUES (?, ?, 'telegram', 'delivered', 1, 'now', 'now')`,
      reminder!.id,
      candidateIds['flagged.test'],
    );

    await send('DELETE', `${APPS}/${own.id}/interviews/${interviewId}`, 'flagged.test');

    expect(sql(`SELECT id FROM application_interviews WHERE id = ?`, interviewId)).toEqual([]);
    expect(
      sql(`SELECT id FROM candidate_notifications WHERE source_id = ?`, interviewId),
    ).toHaveLength(1);
  });

  it('повторный DELETE доснимает напоминание, если интервью уже удалено', async () => {
    const { send, application, sql, candidates, candidateIds } = await setup();
    const own = application('flagged.test');
    const created = await send('POST', `${APPS}/${own.id}/interviews`, 'flagged.test', {
      round: 1,
      scheduledAt: inWeek(),
    });
    const interviewId = created.json().data.id as string;
    (candidates as CandidateStore).deleteApplicationInterview?.(
      candidateIds['flagged.test'],
      own.id,
      interviewId,
    );

    const again = await send(
      'DELETE',
      `${APPS}/${own.id}/interviews/${interviewId}`,
      'flagged.test',
    );

    expect(again.statusCode).toBe(404);
    expect(sql(`SELECT id FROM candidate_notifications WHERE source_id = ?`, interviewId)).toEqual(
      [],
    );
  });

  it('чужое и несуществующее интервью — 404, чужое остаётся', async () => {
    const { send, application, candidates, candidateIds, sql } = await setup();
    const foreign = application('other.test');
    const theirs = candidates.createApplicationInterview(candidateIds['other.test'], foreign.id, {
      round: 1,
    });
    const own = application('flagged.test');

    expect(
      (await send('DELETE', `${APPS}/${foreign.id}/interviews/${theirs.id}`, 'flagged.test'))
        .statusCode,
    ).toBe(404);
    expect(
      (await send('DELETE', `${APPS}/${own.id}/interviews/${theirs.id}`, 'flagged.test'))
        .statusCode,
    ).toBe(404);
    expect(
      (await send('DELETE', `${APPS}/${own.id}/interviews/${randomUUID()}`, 'flagged.test'))
        .statusCode,
    ).toBe(404);
    expect(sql(`SELECT id FROM application_interviews WHERE id = ?`, theirs.id)).toHaveLength(1);
  });
});
