import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

const ORIGIN = 'http://localhost:3000';
const VARIANTS = '/api/v1/candidate/vacancies/cluster-99/pitch/variants';
const LIST = '/api/v1/candidate/text-variants?kind=letter&subjectId=cluster-99';

const cluster: VacancyCluster = {
  id: 'cluster-99',
  canonicalTitle: 'Senior Platform Engineer',
  canonicalCompany: 'CloudScale Inc',
  canonicalLocation: 'Remote',
  isRemote: true,
  descriptionSummary: 'Разработка высоконагруженной платформы на Node.js и Kubernetes',
  skills: ['Node.js', 'TypeScript', 'Kubernetes', 'PostgreSQL'],
  primaryUrl: 'https://example.com/vacancies/99',
  sources: [],
  firstObservedAt: '2026-09-17T00:00:00.000Z',
  lastSeenAt: '2026-09-17T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

/** Модель-заглушка: помнит запросы и отвечает новым текстом на каждый вызов. */
function countingWriter(fail = false) {
  const inputs: CoverLetterWriteInput[] = [];
  const writer: CoverLetterWriter = {
    writeCoverLetter: async (input) => {
      inputs.push(input);
      // Без цифр: проверка письма не пропускает числа, которых нет в фактах профиля.
      const style = ['коротко', 'тепло', 'официально', 'подробно'][inputs.length - 1] ?? 'иначе';
      return fail ? {} : { body: `Здравствуйте! Пишу по вакансии ${style}.`, stage: 'openai:gpt-test' };
    },
  };
  return { writer, inputs };
}

async function setup(options: { cabinetB640?: boolean; fail?: boolean; billing?: boolean } = {}) {
  const { writer, inputs } = countingWriter(options.fail);
  const created = await createApp([cluster], {
    coverLetterWriter: writer,
    cabinetB640: options.cabinetB640 ?? true,
    ...(options.billing ? { billingEnforcement: true } : {}),
  });
  const { cookie, candidateId } = await login(created.app);
  created.candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'test-import',
    entries: [{ memoryId: 'mem-201', domain: 'skill', statement: 'Владею TypeScript, Node.js' }],
  });
  created.candidates.reviewMemories(candidateId, ['mem-201'], 'confirm');
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown, origin = ORIGIN) =>
    created.app.inject({
      method,
      url,
      headers: { cookie, origin },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { ...created, call, inputs, candidateId };
}

function count(databasePath: string, sql: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    return (database.prepare(sql).get() as { n: number }).n;
  } finally {
    database.close();
  }
}

describe('text variant routes without the B640 flag', () => {
  it('answer like a missing address, call no model and write nothing', async () => {
    const { call, inputs, databasePath } = await setup({ cabinetB640: false });
    const missing = await call('GET', '/api/v1/candidate/no-such-route');
    for (const response of [await call('GET', LIST), await call('POST', VARIANTS, { wish: { chips: ['shorter'] } })]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
    expect(inputs).toHaveLength(0);
    expect(count(databasePath, 'SELECT COUNT(*) AS n FROM text_variants')).toBe(0);
  });

  it('leave the letter route as it was', async () => {
    const { call, inputs } = await setup({ cabinetB640: false });
    const response = await call('POST', '/api/v1/candidate/vacancies/cluster-99/pitch', {});
    expect(response.statusCode).toBe(200);
    expect(response.json().data.bodySource).toBe('model');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].wish).toBeUndefined();
  });
});

describe('text variant routes with the B640 flag', () => {
  it('starts with an empty list and three variants left', async () => {
    const { call } = await setup();
    const response = await call('GET', LIST);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ variants: [], remaining: 3 });
    expect((await call('GET', '/api/v1/candidate/text-variants?kind=nope&subjectId=x')).statusCode).toBe(400);
  });

  it('writes a variant with the candidate wish in the model request and stores it sealed', async () => {
    const { call, inputs, databasePath } = await setup();
    const response = await call('POST', VARIANTS, {
      wish: { chips: ['shorter'], text: 'начни с результата' },
      letter: { tone: 'confident' },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data;
    expect(data.remaining).toBe(2);
    expect(data.variant).toMatchObject({
      position: 1,
      text: 'Здравствуйте! Пишу по вакансии коротко.',
      wish: { chips: ['shorter'], text: 'начни с результата' },
    });
    expect(data.variant.payload.emailPitch.body).toBe('Здравствуйте! Пишу по вакансии коротко.');
    expect(inputs[0].wish).toContain('сделай текст заметно короче');
    expect(inputs[0].wish).toContain('«начни с результата»');
    const listed = (await call('GET', LIST)).json().data;
    expect(listed.variants).toHaveLength(1);
    const database = new DatabaseSync(databasePath);
    const row = database.prepare('SELECT text_cipher FROM text_variants').get() as { text_cipher: string };
    database.close();
    expect(row.text_cipher).not.toContain('Пишу по вакансии');
  });

  it('gives three variants and refuses the fourth without calling the model', async () => {
    const { call, inputs } = await setup();
    for (const position of [1, 2, 3]) {
      const response = await call('POST', VARIANTS, {});
      expect(response.statusCode).toBe(201);
      expect(response.json().data.variant.position).toBe(position);
    }
    const fourth = await call('POST', VARIANTS, {});
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error.code).toBe('variant_limit_reached');
    expect(inputs).toHaveLength(3);
    expect((await call('GET', LIST)).json().data).toMatchObject({ remaining: 0 });
  });

  it('refuses a vacancy described only in the request and an exhausted quota without a letter', async () => {
    const { call, inputs, databasePath } = await setup({ billing: true });
    const forged = await call('POST', '/api/v1/candidate/vacancies/cluster-none/pitch/variants', {
      letter: { vacancy: { title: 'Любая', description: 'произвольный текст' } },
    });
    expect(forged.statusCode).toBe(400);
    const database = new DatabaseSync(databasePath);
    const period = (
      database.prepare('SELECT COUNT(*) AS n FROM billing_quota_events').get() as { n: number }
    ).n;
    database.close();
    expect(period).toBe(0);
    expect(inputs).toHaveLength(0);
  });

  it('charges the letter unit once when a variant is the first text for the vacancy', async () => {
    const { call, databasePath } = await setup({ billing: true });
    expect((await call('POST', VARIANTS, {})).statusCode).toBe(201);
    expect(count(databasePath, 'SELECT COUNT(*) AS n FROM billing_quota_events')).toBe(1);
    expect((await call('POST', '/api/v1/candidate/vacancies/cluster-99/pitch', {})).statusCode).toBe(200);
    expect(count(databasePath, 'SELECT COUNT(*) AS n FROM billing_quota_events')).toBe(1);
  });

  it('does not touch the monthly quota', async () => {
    const { call, databasePath } = await setup({ billing: true });
    expect((await call('POST', '/api/v1/candidate/vacancies/cluster-99/pitch', {})).statusCode).toBe(200);
    const before = count(databasePath, 'SELECT COUNT(*) AS n FROM billing_quota_events');
    expect((await call('POST', VARIANTS, {})).statusCode).toBe(201);
    expect((await call('POST', VARIANTS, {})).statusCode).toBe(201);
    expect(count(databasePath, 'SELECT COUNT(*) AS n FROM billing_quota_events')).toBe(before);
  });

  it('keeps the quota charge when a variant fails and stores nothing', async () => {
    const { call, databasePath } = await setup({ fail: true, billing: true });
    const failed = await call('POST', VARIANTS, {});
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe('variant_generation_failed');
    expect(count(databasePath, 'SELECT COUNT(*) AS n FROM text_variants')).toBe(0);
    expect((await call('GET', LIST)).json().data.remaining).toBe(3);
  });

  it('rejects a malformed wish, an unknown vacancy and a foreign origin', async () => {
    const { call, inputs } = await setup();
    const bad: unknown[] = [
      { wish: { chips: ['louder'] } },
      { wish: { text: 'x'.repeat(301) } },
      { wish: { chips: [], extra: 1 } },
      { extra: true },
    ];
    for (const payload of bad) expect((await call('POST', VARIANTS, payload)).statusCode).toBe(400);
    expect(
      (await call('POST', '/api/v1/candidate/vacancies/cluster-none/pitch/variants', {})).statusCode,
    ).toBe(404);
    expect((await call('POST', VARIANTS, {}, 'https://evil.example')).statusCode).toBe(403);
    expect(inputs).toHaveLength(0);
  });
});
