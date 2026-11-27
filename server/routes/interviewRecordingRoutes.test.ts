import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WhisperSegment } from '../providers/whisperTranscriber';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const AUDIO_A = Buffer.from('AUDIO-A-BYTES-0123456789'.repeat(40));
const AUDIO_B = Buffer.from('AUDIO-B-BYTES-9876543210'.repeat(40));
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Reply = (audio: Buffer) => WhisperSegment[] | Error;

function multipart(
  fields: Record<string, string>,
  file?: { data: Buffer; type: string },
): { body: Buffer; type: string } {
  const boundary = `----oq${randomUUID()}`;
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.m4a"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function setup(reply: Reply = () => [{ start: 0, end: 1, text: 'привет' }]) {
  const calls: Buffer[] = [];
  const transcriber = vi.fn(async (audio: Buffer) => {
    calls.push(audio);
    const result = reply(audio);
    if (result instanceof Error) throw result;
    return result;
  });
  const h = await createB640Harness({ pool: () => [], recordingTranscriber: transcriber });
  closers.push(h.close);
  const send = (
    method: 'GET' | 'POST' | 'DELETE',
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
  const interview = (user: HarnessUser) => {
    const app = h.candidates.createApplication(h.candidateIds[user], {
      stage: 'interview',
      manualVacancy: {
        title: 'CTO',
        company: `Co ${randomUUID()}`,
        url: `https://example.test/${randomUUID()}`,
        source: 'other',
      },
    });
    const created = h.candidates.createApplicationInterview(h.candidateIds[user], app.id, {
      round: 1,
    });
    return { applicationId: app.id, interviewId: created.id };
  };
  const create = async (user: HarnessUser = 'flagged.test') => {
    const ids = interview(user);
    const res = await send(
      'POST',
      `/api/v1/candidate/applications/${ids.applicationId}/interviews/${ids.interviewId}/recordings`,
      user,
    );
    return { ...ids, res, ...(res.json().data ?? {}) } as typeof ids & {
      res: typeof res;
      recordingId: string;
      uploadUrl: string;
      expiresAt: string;
      headers: { 'X-Recording-Token': string };
    };
  };
  const upload = (
    rec: { recordingId: string; headers: { 'X-Recording-Token': string } },
    fields: Record<string, string>,
    file: { data: Buffer; type: string } | null = { data: AUDIO_A, type: 'audio/mp4' },
    token: string | undefined = rec.headers['X-Recording-Token'],
  ) => {
    const form = multipart(fields, file ?? undefined);
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/recordings/${rec.recordingId}/segments`,
      payload: form.body,
      headers: { 'content-type': form.type, ...(token ? { 'x-recording-token': token } : {}) },
    });
  };
  const seg = (track: string, segment: number, startedAt = '2026-11-22T10:00:00.000Z') => ({
    track,
    segment: String(segment),
    startedAt,
    durationMs: '600000',
  });
  const sql = <T>(query: string): T[] => {
    const database = new DatabaseSync(h.databasePath);
    try {
      return database.prepare(query).all() as unknown as T[];
    } finally {
      database.close();
    }
  };
  const view = async (id: string, user: HarnessUser = 'flagged.test') =>
    (await send('GET', `/api/v1/candidate/recordings/${id}`, user)).json().data;
  const finish = (
    id: string,
    body = { segments: 1, failed: 0 },
    user: HarnessUser = 'flagged.test',
  ) => send('POST', `/api/v1/candidate/recordings/${id}/finish`, user, body);
  const settled = (id: string) =>
    vi.waitFor(async () => {
      const v = await view(id);
      expect(v.segments.every((s: { status: string }) => s.status !== 'pending')).toBe(true);
    });
  return {
    ...h,
    send,
    interview,
    create,
    upload,
    seg,
    sql,
    view,
    finish,
    settled,
    transcriber,
    calls,
  };
}

describe('B642: создание записи', () => {
  it('201, абсолютный uploadUrl и токен; чужое и несуществующее интервью — 404', async () => {
    const { create, send, interview } = await setup();
    const rec = await create();
    expect(rec.res.statusCode).toBe(201);
    expect(rec.uploadUrl).toBe(
      `http://localhost:3000/api/v1/candidate/recordings/${rec.recordingId}/segments`,
    );
    expect(rec.headers['X-Recording-Token'].length).toBeGreaterThanOrEqual(43);
    expect(Date.parse(rec.expiresAt) - Date.now()).toBeGreaterThan(2.9 * 3_600_000);
    const foreign = interview('other.test');
    const url = `/api/v1/candidate/applications/${foreign.applicationId}/interviews/${foreign.interviewId}/recordings`;
    const denied = await send('POST', url, 'flagged.test');
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe('interview_not_found');
    const missing = await send(
      'POST',
      `/api/v1/candidate/applications/${foreign.applicationId}/interviews/${randomUUID()}/recordings`,
      'other.test',
    );
    expect(missing.statusCode).toBe(404);
  });
});

describe('B642: загрузка сегментов', () => {
  it('202, расшифровка один раз; повтор того же сегмента не зовёт модель', async () => {
    const { create, upload, seg, settled, transcriber, calls } = await setup();
    const rec = await create();
    const first = await upload(rec, seg('mic', 0));
    expect(first.statusCode).toBe(202);
    expect(first.json().data).toEqual({
      recordingId: rec.recordingId,
      track: 'mic',
      segment: 0,
      status: 'accepted',
    });
    await settled(rec.recordingId);
    const again = await upload(rec, seg('mic', 0));
    expect(again.statusCode).toBe(202);
    await settled(rec.recordingId);
    expect(transcriber).toHaveBeenCalledTimes(1);
    expect(calls[0]!.equals(AUDIO_A)).toBe(true);
  });

  it('без токена, с чужим, просроченным и после finish — 401 recording_token_invalid', async () => {
    const { create, upload, seg, finish, databasePath, settled } = await setup();
    const rec = await create();
    const none = await upload(rec, seg('mic', 0), undefined, '');
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('recording_token_invalid');
    expect((await upload(rec, seg('mic', 0), undefined, 'wrong-token')).statusCode).toBe(401);
    const ok = await create();
    await upload(ok, seg('mic', 0));
    await settled(ok.recordingId);
    await finish(ok.recordingId);
    expect((await upload(ok, seg('mic', 1))).statusCode).toBe(401);
    const expired = await create();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('UPDATE interview_recordings SET token_expires_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', expired.recordingId);
    database.close();
    expect((await upload(expired, seg('mic', 0))).statusCode).toBe(401);
  });

  it('плохие поля, нет файла, не тот тип, слишком большой файл — не 2xx', async () => {
    const { create, upload, seg } = await setup();
    const rec = await create();
    const bad = await upload(rec, seg('video', 0));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_segment');
    expect((await upload(rec, { ...seg('mic', 0), segment: '2001' })).statusCode).toBe(400);
    expect((await upload(rec, seg('mic', 0), null)).statusCode).toBe(400);
    expect(
      (await upload(rec, seg('mic', 0), { data: AUDIO_A, type: 'text/plain' })).statusCode,
    ).toBe(400);
    const huge = await upload(rec, seg('mic', 0), {
      data: Buffer.alloc(25 * 1024 * 1024 + 10, 1),
      type: 'audio/mp4',
    });
    expect(huge.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('B642: итог и чтение', () => {
  it('склеивает дорожки по времени; упавший сегмент — в gaps; статусы по ходу', async () => {
    const { create, upload, seg, finish, view, settled } = await setup((audio) =>
      audio.equals(AUDIO_A)
        ? [{ start: 5, end: 6, text: 'Расскажите о себе' }]
        : audio.equals(AUDIO_B)
          ? [{ start: 2, end: 3, text: 'Я руководил командой' }]
          : new Error('whisper_http_500'),
    );
    const rec = await create();
    await upload(rec, seg('system', 0), { data: AUDIO_A, type: 'audio/mp4' });
    await upload(rec, seg('mic', 0), { data: AUDIO_B, type: 'audio/aac' });
    await upload(rec, seg('mic', 1, '2026-11-22T10:10:00.000Z'), {
      data: Buffer.from('zzz'),
      type: 'audio/m4a',
    });
    expect((await view(rec.recordingId)).status).toBe('recording');
    await settled(rec.recordingId);
    const done = await finish(rec.recordingId, { segments: 3, failed: 0 });
    expect(done.statusCode).toBe(200);
    expect(done.headers['cache-control']).toContain('no-store');
    const v = await view(rec.recordingId);
    expect(v.status).toBe('ready');
    expect(v.transcript.map((l: { speaker: string; text: string }) => [l.speaker, l.text])).toEqual(
      [
        ['candidate', 'Я руководил командой'],
        ['interviewer', 'Расскажите о себе'],
      ],
    );
    expect(v.transcript[0].startMs).toBe(2000);
    expect(v.gaps).toEqual([
      { track: 'mic', segment: 1, startedAt: '2026-11-22T10:10:00.000Z', durationMs: 600000 },
    ]);
    expect(v.segments).toHaveLength(3);
  });

  it('все сегменты упали — failed, расшифровки нет', async () => {
    const { create, upload, seg, finish, view, settled } = await setup(() => new Error('x'));
    const rec = await create();
    await upload(rec, seg('mic', 0));
    await settled(rec.recordingId);
    await finish(rec.recordingId);
    const v = await view(rec.recordingId);
    expect(v.status).toBe('failed');
    expect(v.transcript).toBeNull();
  });

  it('сбой модели: сегмент failed, в ответах нет текста ошибки и аудио', async () => {
    const { create, upload, seg, view, settled, sql } = await setup(
      () => new Error('whisper_http_502 SECRET-UPSTREAM-BODY'),
    );
    const rec = await create();
    await upload(rec, seg('mic', 0));
    await settled(rec.recordingId);
    const v = await view(rec.recordingId);
    expect(v.segments[0].status).toBe('failed');
    expect(JSON.stringify(v)).not.toContain('SECRET-UPSTREAM-BODY');
    const rows = sql<{ error_code: string }>('SELECT error_code FROM interview_recording_segments');
    expect(rows[0]!.error_code).toBe('transcription_failed');
  });
});

describe('B642: аудио не хранится, текст зашифрован', () => {
  it('ни одна колонка не содержит байты, base64 и открытый текст', async () => {
    const { create, upload, seg, settled, sql } = await setup(() => [
      { start: 0, end: 1, text: 'уникальная-фраза-кандидата' },
    ]);
    const rec = await create();
    await upload(rec, seg('mic', 0));
    await settled(rec.recordingId);
    const tables = sql<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    const needles = [
      AUDIO_A.toString('latin1').slice(0, 24),
      AUDIO_A.toString('base64').slice(0, 24),
      'уникальная-фраза-кандидата',
    ];
    for (const { name } of tables) {
      for (const row of sql<Record<string, unknown>>(`SELECT * FROM "${name}"`)) {
        const text = JSON.stringify(row);
        for (const needle of needles) expect(text, name).not.toContain(needle);
      }
    }
    const cipher = sql<{ text_cipher: string }>(
      'SELECT text_cipher FROM interview_recording_segments',
    );
    expect(cipher[0]!.text_cipher.startsWith('v1.')).toBe(true);
  });
});

describe('B642: удаление и чужие записи', () => {
  it('DELETE записи; удаление интервью убирает его записи', async () => {
    const { create, upload, seg, settled, send, sql } = await setup();
    const rec = await create();
    await upload(rec, seg('mic', 0));
    await settled(rec.recordingId);
    const gone = await send(
      'DELETE',
      `/api/v1/candidate/recordings/${rec.recordingId}`,
      'flagged.test',
    );
    expect(gone.statusCode).toBe(200);
    expect(gone.json().data).toEqual({ recordingId: rec.recordingId, deleted: true });
    expect(sql('SELECT 1 FROM interview_recording_segments')).toHaveLength(0);
    expect(
      await send('GET', `/api/v1/candidate/recordings/${rec.recordingId}`, 'flagged.test').then(
        (r) => r.statusCode,
      ),
    ).toBe(404);
    const second = await create();
    await upload(second, seg('mic', 0));
    await settled(second.recordingId);
    const del = await send(
      'DELETE',
      `/api/v1/candidate/applications/${second.applicationId}/interviews/${second.interviewId}`,
      'flagged.test',
    );
    expect(del.statusCode).toBe(200);
    expect(sql('SELECT 1 FROM interview_recordings')).toHaveLength(0);
    expect(sql('SELECT 1 FROM interview_recording_segments')).toHaveLength(0);
  });

  it('удаление аккаунта уносит записи и сегменты (152-ФЗ, B689)', async () => {
    const { create, upload, seg, settled, sql, candidates, candidateIds } = await setup();
    const rec = await create();
    await upload(rec, seg('mic', 0));
    await settled(rec.recordingId);

    expect(candidates.deleteCandidate(candidateIds['flagged.test'])).toBe(true);

    expect(sql('SELECT 1 FROM interview_recordings')).toHaveLength(0);
    expect(sql('SELECT 1 FROM interview_recording_segments')).toHaveLength(0);
  });

  it('чужой кандидат: GET, DELETE и finish — 404', async () => {
    const { create, send, finish } = await setup();
    const rec = await create();
    const url = `/api/v1/candidate/recordings/${rec.recordingId}`;
    const get = await send('GET', url, 'other.test');
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe('recording_not_found');
    expect((await send('DELETE', url, 'other.test')).statusCode).toBe(404);
    expect(
      (await finish(rec.recordingId, { segments: 0, failed: 0 }, 'other.test')).statusCode,
    ).toBe(404);
    expect((await send('GET', url, 'flagged.test')).statusCode).toBe(200);
  });
});

describe('B642: флаг записи разговоров (до редакции 1.3)', () => {
  it('выключен — маршрутов записи нет, в /auth/me interviewRecording: false', async () => {
    const h = await createB640Harness({ pool: () => [], interviewRecording: false });
    closers.push(h.close);
    const headers = {
      authorization: `Bearer ${h.tokens['flagged.test']}`,
      origin: 'http://localhost:3000',
    };
    const app = h.candidates.createApplication(h.candidateIds['flagged.test'], {
      stage: 'interview',
      manualVacancy: {
        title: 'CTO',
        company: 'Ко',
        url: 'https://example.test/x',
        source: 'other',
      },
    });
    const iv = h.candidates.createApplicationInterview(h.candidateIds['flagged.test'], app.id, {
      round: 1,
    });
    const id = randomUUID();
    const calls = [
      ['POST', `/api/v1/candidate/applications/${app.id}/interviews/${iv.id}/recordings`],
      ['POST', `/api/v1/candidate/recordings/${id}/segments`],
      ['GET', `/api/v1/candidate/recordings/${id}`],
      ['POST', `/api/v1/candidate/recordings/${id}/finish`],
      ['DELETE', `/api/v1/candidate/recordings/${id}`],
    ] as const;
    for (const [method, url] of calls) {
      const res = await h.app.inject({ method, url, headers });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const me = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    expect(me.json().data.features).toEqual({ cabinetB640: true, interviewRecording: false });
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/applications/${app.id}/interviews/${iv.id}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
  });
});
