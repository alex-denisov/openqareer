import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DebriefOutcome } from '../providers/interviewDebriefWriter';
import type { AudioFormat, WhisperSegment } from '../providers/whisperTranscriber';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const SPEECH: WhisperSegment[] = [
  { start: 0, end: 4, text: 'Расскажите, как вы снижали затраты на инфраструктуру.' },
  { start: 9, end: 30, text: 'Мы перенесли кластеры и сократили счёт на тридцать процентов.' },
];

const OUTCOME: DebriefOutcome = {
  findings: {
    questions: [
      {
        atMs: 0,
        question: 'Снижение затрат',
        summary: 'Рассказал про перенос кластеров',
        prepared: true,
        quote: 'сократили счёт на тридцать процентов',
        fix: null,
      },
    ],
    agreements: [],
    nextPrep: [],
  },
  answeredBy: 'openrouter z-ai/glm',
};

function multipart(fields: Record<string, string>, file: { data: Buffer; type: string }) {
  const boundary = `----oq${randomUUID()}`;
  const parts = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function setup(outcomes: Array<DebriefOutcome | null> = [OUTCOME]) {
  const formats: Array<AudioFormat | undefined> = [];
  const transcriber = vi.fn(async (_audio: Buffer, _signal: AbortSignal, format?: AudioFormat) => {
    formats.push(format);
    return SPEECH;
  });
  const writeDebrief = vi.fn(async () => outcomes.shift() ?? null);
  const h = await createB640Harness({
    pool: () => [],
    recordingTranscriber: transcriber,
    interviewDebriefWriter: { writeDebrief },
  });
  closers.push(h.close);
  const send = (method: 'GET' | 'POST' | 'PUT', url: string, user: HarnessUser, payload?: object) =>
    h.app.inject({
      method,
      url,
      ...(payload ? { payload } : {}),
      headers: { authorization: `Bearer ${h.tokens[user]}`, origin: 'http://localhost:3000' },
    });
  const user: HarnessUser = 'flagged.test';
  const application = h.candidates.createApplication(h.candidateIds[user], {
    stage: 'interview',
    manualVacancy: {
      title: 'CTO',
      company: 'Ко',
      url: `https://example.test/${randomUUID()}`,
      source: 'other',
    },
  });
  const interview = h.candidates.createApplicationInterview(h.candidateIds[user], application.id, {
    round: 1,
    scheduledAt: '2026-11-20T10:00:00.000Z',
  });
  const debrief = (tail = '', method: 'GET' | 'POST' | 'PUT' = 'GET', body?: object, who = user) =>
    send(method, `/api/v1/candidate/applications/${application.id}/debrief${tail}`, who, body);
  const record = async (source: 'app' | 'upload', track: string, type: string) => {
    const created = await send(
      'POST',
      `/api/v1/candidate/applications/${application.id}/interviews/${interview.id}/recordings`,
      user,
      { source },
    );
    const rec = created.json().data as { recordingId: string; headers: Record<string, string> };
    const form = multipart(
      { track, segment: '0', startedAt: '2026-11-20T10:00:00.000Z', durationMs: '30000' },
      { data: Buffer.from('RIFF-audio'.repeat(50)), type },
    );
    const segment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/recordings/${rec.recordingId}/segments`,
      payload: form.body,
      headers: {
        'content-type': form.type,
        'x-recording-token': rec.headers['X-Recording-Token']!,
      },
    });
    return { recordingId: rec.recordingId, segment };
  };
  const finished = async (recordingId: string) => {
    await vi.waitFor(async () => {
      const view = (await send('GET', `/api/v1/candidate/recordings/${recordingId}`, user)).json()
        .data;
      expect(view.segments.every((s: { status: string }) => s.status !== 'pending')).toBe(true);
    });
    await send('POST', `/api/v1/candidate/recordings/${recordingId}/finish`, user, {
      segments: 1,
      failed: 0,
    });
  };
  const sql = <T>(query: string): T[] => {
    const database = new DatabaseSync(h.databasePath);
    try {
      return database.prepare(query).all() as unknown as T[];
    } finally {
      database.close();
    }
  };
  return { h, application, interview, debrief, record, finished, sql, formats, writeDebrief };
}

describe('B751: разбор после интервью', () => {
  it('без записи: интервью отклика, пустая расшифровка, модель не звали; чужой — 404', async () => {
    const { debrief, interview, writeDebrief } = await setup();
    const res = await debrief();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      interviewId: interview.id,
      recording: null,
      transcript: [],
      metrics: null,
      analysis: { status: 'none' },
    });
    expect((await debrief('', 'GET', undefined, 'other.test')).statusCode).toBe(404);
    expect(writeDebrief).not.toHaveBeenCalled();
  });

  it('загруженный файл: WAV в Whisper, реплики без голоса, доли речи нет', async () => {
    const { debrief, record, finished, formats } = await setup();
    const { recordingId, segment } = await record('upload', 'upload', 'audio/wav');
    expect(segment.statusCode).toBe(202);
    await finished(recordingId);
    expect(formats).toEqual(['wav']);
    const view = (await debrief()).json().data;
    expect(view.recording).toMatchObject({ id: recordingId, source: 'upload', status: 'ready' });
    expect(view.transcript.map((line: { speaker: unknown }) => line.speaker)).toEqual([null, null]);
    expect(view.metrics).toMatchObject({ candidateShare: null, interviewerShare: null });
  });

  it('дорожка не по источнику записи — 400', async () => {
    const { record } = await setup();
    expect((await record('upload', 'mic', 'audio/wav')).segment.statusCode).toBe(400);
    expect((await record('app', 'upload', 'audio/mp4')).segment.statusCode).toBe(400);
  });

  it('один вызов модели на расшифровку: повтор берёт сохранённый разбор, текст запечатан', async () => {
    const { debrief, record, finished, writeDebrief, sql } = await setup();
    const { recordingId } = await record('upload', 'upload', 'audio/wav');
    await finished(recordingId);
    const first = (await debrief('/analysis', 'POST')).json().data;
    expect(first.analysis).toMatchObject({ status: 'ready', answeredBy: 'openrouter z-ai/glm' });
    expect(first.analysis.findings.questions[0].quote).toBe('сократили счёт на тридцать процентов');
    await debrief('/analysis', 'POST');
    expect((await debrief()).json().data.analysis.status).toBe('ready');
    expect(writeDebrief).toHaveBeenCalledTimes(1);
    const stored = sql<{ findings_cipher: string }>(
      'SELECT findings_cipher FROM interview_debrief_analyses',
    );
    expect(stored[0]?.findings_cipher).not.toContain('тридцать');
  });

  it('сбой модели: «failed», «Повторить разбор» зовёт модель снова', async () => {
    const { debrief, record, finished, writeDebrief } = await setup([null, OUTCOME]);
    const { recordingId } = await record('upload', 'upload', 'audio/wav');
    await finished(recordingId);
    expect((await debrief('/analysis', 'POST')).json().data.analysis.status).toBe('failed');
    expect((await debrief()).json().data.analysis.status).toBe('failed');
    expect((await debrief('/analysis', 'POST')).json().data.analysis.status).toBe('ready');
    expect(writeDebrief).toHaveBeenCalledTimes(2);
  });

  it('заметки, договорённость в отклик и имя собеседника (запечатано) до загрузки файла', async () => {
    const { h, debrief, application, sql } = await setup();
    const notes = await debrief('/notes', 'PUT', { notes: 'Спросили про команду' });
    expect(notes.json().data.notes).toBe('Спросили про команду');
    expect((await debrief('/agreements', 'POST', { text: 'Ответ до пятницы' })).statusCode).toBe(
      200,
    );
    const app = h.candidates.getApplication(h.candidateIds['flagged.test'], application.id);
    expect(app?.notes).toBe('Ответ до пятницы');
    expect((await debrief('/interviewer', 'PUT', { name: ' Ирина Петрова ' })).statusCode).toBe(
      200,
    );
    expect((await debrief()).json().data.interviewerName).toBe('Ирина Петрова');
    const rows = sql<{ name_cipher: string }>('SELECT name_cipher FROM interview_interviewers');
    expect(rows[0]?.name_cipher).not.toContain('Ирина');
    expect((await debrief('/agreements', 'POST', { text: '' })).statusCode).toBe(400);
  });
});
