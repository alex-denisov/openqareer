import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { SAMPLE_BUILDER_RESUME } from '../shared/resumeBuilder/model';
import { builderResumeText } from '../shared/resumeBuilder/text';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 5),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
  secureCookies: false,
  allowedOrigins: ['http://localhost:3000'],
  seedAccounts: [],
};

const noSessions: SessionAuth = {
  async register() {
    throw new Error('registration unavailable in this test double');
  },
  async login() {
    return null;
  },
  isUsernameTaken() {
    return false;
  },
  authenticate() {
    return null;
  },
  logout() {},
};

const unusedProvider: CoachProvider = {
  async createTurn() {
    throw new Error('the resume builder must not start a coach turn');
  },
};

const VACANCY = {
  id: 'src-hh-search:135781394',
  title: 'Главный бухгалтер',
  company: 'ООО «Север»',
  description:
    'Требования:\n- знание РСБУ и МСФО\n- опыт работы в 1С:ERP\n- Excel на уровне Power Query\n' +
    'Условия:\n- офис в Москве, полный день, белая зарплата, ДМС после испытательного срока, ' +
    'современный офис рядом с метро, обучение за счёт компании, корпоративные мероприятия. '.repeat(
      3,
    ),
  requiredSkills: ['Бухгалтерская отчетность'],
};

const engine = {
  getVacancy: (id: string) => (id === VACANCY.id ? VACANCY : undefined),
  loadVacancyDescription: async () => ({ unavailable: false, status: 'skipped' }),
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: unusedProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
    multiSourceVacancyEngine: engine as unknown as MultiSourceVacancyEngine,
  });
  apps.push(app);
  stores.push(store);
  return {
    app,
    store,
    candidateId: candidate.id,
    authorization: `Bearer ${candidate.accessToken}`,
  };
}

const ORIGIN = { origin: 'http://localhost:3000' };

describe('POST /api/v1/resume-builder/keywords (B567)', () => {
  it('finds an hh link in the pool and reads its keywords without a model', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/resume-builder/keywords',
      headers: ORIGIN,
      payload: { link: 'https://hh.ru/vacancy/135781394' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      outcome: 'pool',
      vacancy: { title: 'Главный бухгалтер', company: 'ООО «Север»' },
    });
    expect(response.json().data.keywords).toEqual(
      expect.arrayContaining([
        'Бухгалтерская отчетность',
        'РСБУ',
        'МСФО',
        '1С:ERP',
        'Excel',
        'Power Query',
      ]),
    );
  });

  it('says honestly when a link is outside the pool or not a vacancy link', async () => {
    const { app } = await createApp();
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/resume-builder/keywords',
      headers: ORIGIN,
      payload: { link: 'https://hh.ru/vacancy/999999' },
    });
    expect(missing.json().data).toEqual({ outcome: 'not_in_pool', keywords: [] });
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/resume-builder/keywords',
      headers: ORIGIN,
      payload: { link: 'https://careers.example.com/jobs/1' },
    });
    expect(other.json().data.outcome).toBe('unsupported_link');
  });

  it('reads pasted vacancy text and refuses a foreign origin', async () => {
    const { app } = await createApp();
    const text = await app.inject({
      method: 'POST',
      url: '/api/v1/resume-builder/keywords',
      headers: ORIGIN,
      payload: { text: 'Требования:\n- опыт с SQL и Python от 3 лет\n- английский B2' },
    });
    expect(text.json().data.outcome).toBe('text');
    expect(text.json().data.keywords).toEqual(expect.arrayContaining(['SQL', 'Python']));
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/resume-builder/keywords',
      headers: { origin: 'https://evil.example' },
      payload: { text: 'Требования: SQL' },
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('POST /api/v1/candidate/resume-builder/export (B567)', () => {
  it('needs a session', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume-builder/export',
      headers: ORIGIN,
      payload: { format: 'pdf', template: 'strict', resume: SAMPLE_BUILDER_RESUME },
    });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['pdf', 'application/pdf', '%PDF-'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'PK'],
  ] as const)('returns a real %s file', async (format, type, magic) => {
    const { app, authorization } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume-builder/export',
      headers: { authorization },
      payload: { format, template: 'modern', resume: SAMPLE_BUILDER_RESUME },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(type);
    expect(response.headers['content-disposition']).toBe(`attachment; filename="resume.${format}"`);
    expect(response.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
  });

  it('rejects an unknown template', async () => {
    const { app, authorization } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume-builder/export',
      headers: { authorization },
      payload: { format: 'pdf', template: 'photo', resume: SAMPLE_BUILDER_RESUME },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('builder resume → profile (B567)', () => {
  it('imports with the source «конструктор резюме»', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: { text: builderResumeText(SAMPLE_BUILDER_RESUME), source: 'builder' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.factCount).toBeGreaterThan(0);
    expect(JSON.stringify(store.getSnapshot(candidateId))).toContain('Импорт: конструктор резюме');
  });
});
