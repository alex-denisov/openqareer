import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';
import { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';

const APPS = '/api/v1/candidate/applications';
const DAY_MS = 86_400_000;
const USER = 'flagged.test';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

interface DeliveryRow {
  readonly channel: string;
  readonly status: string;
  readonly next_attempt_at: string;
}

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const send = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: { authorization: `Bearer ${h.tokens[USER]}`, origin: 'http://localhost:3000' },
    });
  await send('PUT', '/api/v1/candidate/notifications/preferences/ev-reminder', {
    app: true,
    email: true,
    telegram: false,
  });
  const application = h.candidates.createApplication(h.candidateIds[USER], {
    stage: 'interview',
    manualVacancy: {
      title: 'CTO',
      company: `Co ${randomUUID()}`,
      url: `https://example.test/${randomUUID()}`,
      source: 'other',
    },
  });
  const deliveries = (interviewId: string): DeliveryRow[] => {
    const database = new DatabaseSync(h.databasePath, { readOnly: true });
    try {
      return database
        .prepare(
          `SELECT d.channel, d.status, d.next_attempt_at FROM candidate_notification_deliveries d
           JOIN candidate_notifications n ON n.id = d.notification_id
           WHERE n.source_type = 'interview' AND n.source_id = ? ORDER BY d.next_attempt_at`,
        )
        .all(interviewId) as unknown as DeliveryRow[];
    } finally {
      database.close();
    }
  };
  const createInterview = async (scheduledAt: string) =>
    (await send('POST', `${APPS}/${application.id}/interviews`, { round: 1, scheduledAt })).json()
      .data.id as string;
  /** То, что заберёт отправщик в момент `now`: только напоминания этого интервью. */
  const claimedAt = (interviewId: string, now: string) => {
    const repository = new SqliteNotificationRepository({ databasePath: h.databasePath });
    try {
      return repository
        .claimDueDeliveries(now, 100)
        .filter((row) => row.source.type === 'interview' && row.source.id === interviewId);
    } finally {
      repository.close();
    }
  };
  /** Что видно в ленте в момент `now`: только напоминания. */
  const feedAt = (now: string) => {
    const repository = new SqliteNotificationRepository({ databasePath: h.databasePath });
    try {
      return repository
        .listForFeed(h.candidateIds[USER], { max: 100, now })
        .rows.filter((row) => row.kind === 'interview_reminder');
    } finally {
      repository.close();
    }
  };
  return { send, application, deliveries, createInterview, claimedAt, feedAt };
}

const at = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('B731: напоминание об интервью уходит за сутки, а не сразу', () => {
  it('ставит отправку на время интервью минус 24 часа', async () => {
    const { deliveries, createInterview } = await setup();
    const scheduledAt = at(7 * DAY_MS);

    const id = await createInterview(scheduledAt);

    const rows = deliveries(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', status: 'pending' });
    expect(Date.parse(rows[0]!.next_attempt_at)).toBe(Date.parse(scheduledAt) - DAY_MS);
  });

  it('отправщик не берёт напоминание раньше срока — только с момента «за сутки»', async () => {
    const { claimedAt, createInterview } = await setup();
    const scheduledAt = at(7 * DAY_MS);
    const due = Date.parse(scheduledAt) - DAY_MS;

    const id = await createInterview(scheduledAt);

    expect(claimedAt(id, new Date().toISOString())).toEqual([]);
    expect(claimedAt(id, new Date(due - 60_000).toISOString())).toEqual([]);
    expect(claimedAt(id, new Date(due).toISOString())).toMatchObject([
      { channel: 'email', notification: { kind: 'interview_reminder' } },
    ]);
  });

  it('если до интервью меньше суток, сразу ничего не отправляет', async () => {
    const { deliveries, createInterview } = await setup();

    const id = await createInterview(at(5 * 60 * 60 * 1_000));

    expect(deliveries(id)).toEqual([]);
  });

  it('новая дата заменяет прежнее неотправленное напоминание', async () => {
    const { send, application, deliveries, createInterview } = await setup();
    const id = await createInterview(at(7 * DAY_MS));
    const moved = at(10 * DAY_MS);

    const patched = await send('PATCH', `${APPS}/${application.id}/interviews/${id}`, {
      scheduledAt: moved,
    });

    expect(patched.statusCode).toBe(200);
    const rows = deliveries(id);
    expect(rows).toHaveLength(1);
    expect(Date.parse(rows[0]!.next_attempt_at)).toBe(Date.parse(moved) - DAY_MS);
  });

  it('снятая дата снимает и напоминание', async () => {
    const { send, application, deliveries, createInterview } = await setup();
    const id = await createInterview(at(7 * DAY_MS));

    await send('PATCH', `${APPS}/${application.id}/interviews/${id}`, { scheduledAt: null });

    expect(deliveries(id)).toEqual([]);
  });

  it('удалённое интервью уносит запланированное напоминание', async () => {
    const { send, application, deliveries, createInterview } = await setup();
    const id = await createInterview(at(7 * DAY_MS));

    const deleted = await send('DELETE', `${APPS}/${application.id}/interviews/${id}`);

    expect(deleted.statusCode).toBe(200);
    expect(deliveries(id)).toEqual([]);
  });
});

describe('B731: напоминание видно в ленте за сутки, а не при назначении', () => {
  it('появляется за 24 часа до интервью', async () => {
    const { createInterview, feedAt } = await setup();
    const scheduledAt = at(7 * DAY_MS);
    const due = Date.parse(scheduledAt) - DAY_MS;

    const id = await createInterview(scheduledAt);

    expect(feedAt(new Date(due - 60_000).toISOString())).toEqual([]);
    expect(feedAt(new Date(due).toISOString())).toMatchObject([
      { sourceId: id, createdAt: new Date(due).toISOString() },
    ]);
  });

  it('до интервью меньше суток — видно сразу; прошедшее интервью не напоминает', async () => {
    const { createInterview, feedAt } = await setup();
    const id = await createInterview(at(5 * 3_600_000));
    await createInterview(at(-2 * DAY_MS));

    expect(feedAt(at(1_000)).map((row) => row.sourceId)).toEqual([id]);
  });

  it('перенос двигает напоминание, удаление снимает', async () => {
    const { send, application, createInterview, feedAt } = await setup();
    const id = await createInterview(at(7 * DAY_MS));
    const path = `${APPS}/${application.id}/interviews/${id}`;
    await send('PATCH', path, { scheduledAt: at(10 * DAY_MS) });

    expect(feedAt(at(8 * DAY_MS))).toEqual([]);
    expect(feedAt(at(9 * DAY_MS + 60_000))).toHaveLength(1);

    await send('DELETE', path);
    expect(feedAt(at(9 * DAY_MS + 60_000))).toEqual([]);
  });

  it('B671: в ленте кабинета — компания, роль, время и «Важно»', async () => {
    const { send, createInterview, application } = await setup();
    const scheduledAt = at(5 * 3_600_000);
    await createInterview(scheduledAt);

    const feed = (await send('GET', '/api/v1/candidate/b640/notifications')).json().data;

    expect(feed.pinned).toMatchObject([
      {
        kind: 'interview_reminder',
        title: `Скоро интервью · ${application.vacancy?.company}`,
        role: 'CTO',
        eventAt: scheduledAt,
        important: true,
      },
    ]);
  });
});
