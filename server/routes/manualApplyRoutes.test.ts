import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
import { SqliteManualApplyRepository } from '../candidate/sqliteManualApplyRepository';
import { seedResume } from '../testHelpers/letterApprovalHarness';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

const ORIGIN = 'http://localhost:3000';
const QUEUE = '/api/v1/candidate/manual-applications';
const PITCH = '/api/v1/candidate/vacancies/cluster-99/pitch';
const APPROVAL = '/api/v1/candidate/vacancies/cluster-99/letter-approvals';
const FORM = '/api/v1/candidate/vacancies/cluster-99/questionnaire';

const cluster: VacancyCluster = {
  id: 'cluster-99',
  canonicalTitle: 'Senior Platform Engineer',
  canonicalCompany: 'CloudScale Inc',
  canonicalLocation: 'Берлин, Германия',
  isRemote: true,
  descriptionSummary: 'Разработка высоконагруженной платформы на Node.js и Kubernetes',
  skills: ['Node.js', 'TypeScript', 'Kubernetes', 'PostgreSQL'],
  primaryUrl: 'https://www.linkedin.com/jobs/view/99',
  sources: [],
  firstObservedAt: '2026-09-17T00:00:00.000Z',
  lastSeenAt: '2026-09-17T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

/** Модель-заглушка: помнит запросы и отвечает новым текстом на каждый вызов. */
function countingWriter(fail = false, resume = false) {
  const inputs: CoverLetterWriteInput[] = [];
  const writer: CoverLetterWriter = {
    writeCoverLetter: async (input) => {
      inputs.push(input);
      // Без цифр: проверка письма не пропускает числа, которых нет в фактах профиля.
      const style = ['коротко', 'тепло', 'официально', 'подробно'][inputs.length - 1] ?? 'иначе';
      return fail
        ? {}
        : {
            body: `Здравствуйте! Пишу по вакансии ${style}.${resume ? ' Резюме приложено.' : ''}`,
            stage: 'openai:gpt-test',
          };
    },
  };
  return { writer, inputs };
}

async function setup(
  options: {
    cabinetB640?: boolean;
    fail?: boolean;
    resume?: boolean;
    billing?: boolean;
    primaryUrl?: string;
  } = {},
) {
  const { writer, inputs } = countingWriter(options.fail, options.resume);
  const created = await createApp(
    [{ ...cluster, primaryUrl: options.primaryUrl ?? cluster.primaryUrl }],
    {
      coverLetterWriter: writer,
      cabinetB640: options.cabinetB640 ?? true,
      ...(options.billing ? { billingEnforcement: true } : {}),
    },
  );
  const { cookie, candidateId } = await login(created.app);
  created.candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'test-import',
    entries: [{ memoryId: 'mem-201', domain: 'skill', statement: 'Владею TypeScript, Node.js' }],
  });
  created.candidates.reviewMemories(candidateId, ['mem-201'], 'confirm');
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, origin = ORIGIN) =>
    created.app.inject({
      method,
      url,
      headers: { cookie, origin },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { ...created, call, inputs, candidateId };
}

const put = { vacancyId: 'cluster-99', reason: 'linkedin' };
type Call = Awaited<ReturnType<typeof setup>>['call'];

/** Список после того, как фоновый сбор закончился. */
async function prepared(call: Call) {
  return vi.waitFor(async () => {
    const [item] = (await call('GET', QUEUE)).json().data;
    expect(item.letter).toBeTruthy();
    return item;
  });
}

describe('очередь «отправить вручную»', () => {
  it('без флага отвечает как несуществующий адрес', async () => {
    const { call } = await setup({ cabinetB640: false });
    const missing = await call('GET', '/api/v1/candidate/no-such-route');
    for (const response of [await call('GET', QUEUE), await call('POST', QUEUE, put)]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
  });

  it('собирает письмо и вопросы сама, повторная постановка и экран письма модель не зовут', async () => {
    const { call, inputs, databasePath } = await setup({ billing: true });
    expect((await call('POST', QUEUE, put)).statusCode).toBe(201);
    const pitch = await call('POST', PITCH, { tone: 'executive' });
    expect(pitch.json().data.emailPitch.body).toContain('коротко');
    const item = await prepared(call);
    expect(item).toMatchObject({
      vacancyId: 'cluster-99',
      reason: 'linkedin',
      host: 'linkedin.com',
      state: 'needs_answer',
      letter: 'Здравствуйте! Пишу по вакансии коротко.',
    });
    expect((await call('POST', QUEUE, put)).statusCode).toBe(200);
    await prepared(call);
    expect(inputs).toHaveLength(1);
    const database = new DatabaseSync(databasePath);
    const quota = database.prepare('SELECT COUNT(*) AS n FROM billing_quota_events').get() as {
      n: number;
    };
    const row = database.prepare('SELECT payload_cipher AS c FROM manual_apply_queue').get() as {
      c: string;
    };
    database.close();
    expect(quota.n).toBe(1);
    expect(row.c).not.toContain('Пишу');
  });

  it('факты изменились — экран письма получает новое письмо, а не прежнее из очереди', async () => {
    const { call, inputs, candidates, candidateId } = await setup({ resume: true });
    seedResume(candidates, candidateId, 'Head of Platform', ['CSAT вырос с 23% до 68%']);
    await call('POST', QUEUE, put);
    await prepared(call);
    candidates.changeMemory(candidateId, 'import:test:bullet-0', {
      action: 'correct',
      statement: 'CSAT вырос с 25% до 85%',
    });
    const pitch = await call('POST', PITCH, { tone: 'executive' });
    expect(pitch.json().data.emailPitch.body).toContain('тепло');
    expect(inputs).toHaveLength(2);
  });

  it('одобренное письмо с опровергнутым числом очередь не отдаёт', async () => {
    const { call, candidates, candidateId } = await setup();
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [{ memoryId: 'mem-202', domain: 'skill', statement: 'CSAT вырос до 68%' }],
    });
    candidates.reviewMemories(candidateId, ['mem-202'], 'confirm');
    await call('POST', QUEUE, put);
    await prepared(call);
    const body = 'Добрый день. Повысил CSAT до 68%.';
    const approved = await call('POST', APPROVAL, {
      circle: 3,
      language: 'ru',
      tone: 'executive',
      body,
      usedEvidenceIds: [],
      includedWorkplaceIds: [],
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await call('GET', `${QUEUE}/cluster-99`)).json().data.letter).toBe(body);
    candidates.changeMemory(candidateId, 'mem-202', {
      action: 'correct',
      statement: 'CSAT вырос до 85%',
    });
    expect((await call('GET', `${QUEUE}/cluster-99`)).json().data.letter).toBeNull();
  });

  it('после ответов на вопросы отклик готов', async () => {
    const { call } = await setup();
    await call('POST', QUEUE, put);
    const item = await prepared(call);
    const form = (await call('GET', FORM)).json().data;
    expect(form.missingRequired).toBe(item.missingAnswers);
    const answers = form.questions.map((question: { id: string; options?: string[] }) => ({
      questionId: question.id,
      text: question.options?.[0] ?? 'ответ',
    }));
    await call('PUT', `${FORM}/answers`, { answers });
    expect((await call('GET', `${QUEUE}/cluster-99`)).json().data.state).toBe('ready');
  });

  it('«Отправлено» записывает отклик и убирает его из очереди; второй раз в очередь он не встаёт', async () => {
    const { call, candidates, candidateId } = await setup();
    const { applicationId } = (await call('POST', QUEUE, put)).json().data;
    await prepared(call);
    expect((await call('POST', `${QUEUE}/cluster-99/sent`, {})).statusCode).toBe(200);
    expect(candidates.getApplication(candidateId, applicationId)?.stage).toBe('applied');
    expect((await call('GET', QUEUE)).json().data).toEqual([]);
    expect((await call('POST', `${QUEUE}/cluster-99/sent`, {})).statusCode).toBe(404);
    expect((await call('POST', QUEUE, put)).json().error.code).toBe('already_applied');
  });

  it('«Не откликаюсь» убирает из очереди и кладёт отклик в архив', async () => {
    const { call, candidates, candidateId } = await setup();
    const { applicationId } = (await call('POST', QUEUE, put)).json().data;
    await prepared(call);
    expect((await call('POST', `${QUEUE}/cluster-99/skip`, {})).statusCode).toBe(200);
    expect(candidates.getApplication(candidateId, applicationId)?.stage).toBe('archived');
    expect((await call('GET', QUEUE)).json().data).toEqual([]);
    expect((await call('POST', QUEUE, put)).statusCode).toBe(200);
    expect(candidates.getApplication(candidateId, applicationId)?.stage).toBe('saved');
  });

  it('с чужого origin не ставит, не отмечает и не убирает', async () => {
    const { call } = await setup();
    const evil = 'https://evil.example';
    expect((await call('POST', QUEUE, put, evil)).statusCode).toBe(403);
    expect((await call('GET', QUEUE)).json().data).toEqual([]);
    await call('POST', QUEUE, put);
    await prepared(call);
    for (const tail of ['sent', 'skip']) {
      expect((await call('POST', `${QUEUE}/cluster-99/${tail}`, {}, evil)).statusCode).toBe(403);
    }
    expect((await call('GET', QUEUE)).json().data).toHaveLength(1);
  });

  it('очередь другого кандидата не видна и не меняется', async () => {
    const { call, candidates, databasePath } = await setup();
    await call('POST', QUEUE, put);
    await prepared(call);
    const stranger = candidates.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const database = new DatabaseSync(databasePath);
    database.prepare('UPDATE manual_apply_queue SET candidate_id = ?').run(stranger.id);
    database.close();
    expect((await call('GET', QUEUE)).json().data).toEqual([]);
    expect((await call('GET', `${QUEUE}/cluster-99`)).statusCode).toBe(404);
    for (const tail of ['sent', 'skip']) {
      expect((await call('POST', `${QUEUE}/cluster-99/${tail}`, {})).statusCode).toBe(404);
    }
  });

  it('принимает причину площадки и её хост, чужой текст в хосте — нет', async () => {
    const { call } = await setup();
    const ok = await call('POST', QUEUE, {
      ...put,
      reason: 'account_required',
      host: 'acme.myworkdayjobs.com',
    });
    expect(ok.json().data).toMatchObject({
      reason: 'account_required',
      host: 'acme.myworkdayjobs.com',
    });
    expect((await call('POST', QUEUE, { ...put, host: '<b>x</b>' })).statusCode).toBe(400);
  });

  it('чтение очереди модель не зовёт и ничего не пишет', async () => {
    const { call, inputs, databasePath } = await setup({ fail: true });
    await call('POST', QUEUE, put);
    const row = () => {
      const database = new DatabaseSync(databasePath);
      const value = database.prepare('SELECT * FROM manual_apply_queue').get();
      database.close();
      return JSON.stringify(value);
    };
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const before = row();
    for (const path of [QUEUE, `${QUEUE}/cluster-99`, QUEUE]) await call('GET', path);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inputs).toHaveLength(1);
    expect(row()).toBe(before);
  });

  it('после трёх отказов квота возвращена, новая постановка даёт новые попытки', async () => {
    const { call, inputs, databasePath } = await setup({ fail: true, billing: true });
    const read = (sql: string) => {
      const database = new DatabaseSync(databasePath);
      const { n } = database.prepare(sql).get() as { n: number };
      database.close();
      return n;
    };
    const attempts = () => read('SELECT attempts AS n FROM manual_apply_queue');
    const charged = () => read('SELECT COUNT(*) AS n FROM billing_quota_events');
    for (const count of [1, 2, 3]) {
      await vi.waitFor(async () => {
        await call('POST', QUEUE, put);
        expect(inputs).toHaveLength(count);
      });
      if (count < 3) expect(charged()).toBe(1);
    }
    await vi.waitFor(() => expect(attempts()).toBe(4));
    expect(charged()).toBe(0);
    const [item] = (await call('GET', QUEUE)).json().data;
    expect(item).toMatchObject({ letter: null, preparing: false, state: 'needs_answer' });
    expect((await call('POST', QUEUE, put)).json().data.preparing).toBe(true);
    await vi.waitFor(() => expect(inputs).toHaveLength(4));
    expect(charged()).toBe(1);
  });

  it('прерванный сбор продолжает фоновый такт, но не раньше простоя', async () => {
    const timers = vi.spyOn(globalThis, 'setInterval');
    const { call, inputs, databasePath } = await setup({ fail: true, billing: true });
    const tick = timers.mock.calls.find(([, delay]) => delay === 60_000)![0] as () => void;
    timers.mockRestore();
    const run = (sql: string) => {
      const database = new DatabaseSync(databasePath);
      const result = database.prepare(sql).all() as Array<Record<string, number>>;
      database.close();
      return result;
    };
    const age = () => run("UPDATE manual_apply_queue SET updated_at = '2026-01-01T00:00:00.000Z'");
    await call('POST', QUEUE, put);
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    tick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inputs).toHaveLength(1);
    age();
    tick();
    tick();
    await vi.waitFor(() => expect(inputs).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Процесс умер на последней попытке: такт модель не зовёт, единицу квоты возвращает.
    run('UPDATE manual_apply_queue SET attempts = 3');
    age();
    tick();
    expect(inputs).toHaveLength(2);
    expect(run('SELECT COUNT(*) AS n FROM billing_quota_events')[0]!.n).toBe(0);
  });

  it('попытку сбора получает один процесс', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(
      "CREATE TABLE candidates (id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('c1')",
    );
    const queue = new SqliteManualApplyRepository(database, Buffer.alloc(32, 7));
    const at = '2026-11-25T00:00:00.000Z';
    const item = queue.enqueue('c1', 'v1', {
      applicationId: 'a1',
      at,
      title: 'Роль',
      company: '',
      url: '',
      source: '',
      reason: 'linkedin',
      host: 'linkedin.com',
    });
    expect(queue.claimAttempt('c1', item, at)).toBe(true);
    expect(queue.claimAttempt('c1', item, at)).toBe(false);
    database.close();
  });

  it('адрес вакансии не https в ссылку не попадает', async () => {
    for (const primaryUrl of ['http://example.com/1', 'javascript:alert(1)']) {
      const { call } = await setup({ primaryUrl });
      expect((await call('POST', QUEUE, put)).json().data.url).toBeNull();
    }
  });

  it('выгрузка данных содержит очередь, удаление кандидата её стирает', async () => {
    const { call, candidates, candidateId, databasePath } = await setup();
    await call('POST', QUEUE, put);
    await prepared(call);
    expect(candidates.exportCandidate(candidateId).tracker.manualApplications).toMatchObject([
      { vacancyId: 'cluster-99', reason: 'linkedin', letter: expect.stringContaining('Пишу') },
    ]);
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON');
    database.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
    const left = database.prepare('SELECT COUNT(*) AS n FROM manual_apply_queue').get() as {
      n: number;
    };
    database.close();
    expect(left.n).toBe(0);
  });
});
