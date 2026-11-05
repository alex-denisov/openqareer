import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { serializeCoachInput } from './domain/coachInputSerialization';
import type { CoachTurnInput } from './domain/coach';
import { coachTurnInputSchema } from './domain/coach';
import { preferFinishedReply } from './providers/coachReplyShape';
import type { CoachProvider, CoachTurnOptions } from './providers/coachProvider';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  openAIKey: 'not-used-by-test',
  openRouterKey: 'not-used-by-test',
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 7),
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

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

const VACANCY = {
  id: 'cluster-v1',
  canonicalTitle: 'Начальник отдела поддержки',
  canonicalCompany: 'Компания',
  skills: [],
};
const OTHER_VACANCY = { ...VACANCY, id: 'cluster-v2', canonicalCompany: 'Другая компания' };

async function harness() {
  const seen: CoachTurnInput[] = [];
  const seenOptions: (CoachTurnOptions | undefined)[] = [];
  const provider: CoachProvider = {
    async createTurn(input, _key, options) {
      seen.push(input);
      seenOptions.push(options);
      return {
        provider: 'openai',
        model: 'gpt-5.6-sol',
        responseId: `response-${seen.length}`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        result: {
          message: 'Ответ.',
          phase: input.phase,
          memoryCandidates: [],
          nextQuestion: null,
          completeness: { known: [], unknown: [] },
          safety: { needsHuman: false, reason: null },
          careerTrack: null,
          actionProposals: [],
        },
      };
    },
  };
  const store = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: config.dataEncryptionKey });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
    multiSourceVacancyEngine: { getActiveCluster: (id: string) => [VACANCY, OTHER_VACANCY].find((item) => item.id === id) },
  } as unknown as Parameters<typeof buildApp>[0]);
  apps.push(app);
  stores.push(store);
  const authorization = `Bearer ${candidate.accessToken}`;
  const turn = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, origin: 'http://localhost:3000', 'idempotency-key': randomUUID() },
      payload: { messageId: randomUUID(), ...payload },
    });
  const addStory = (title: string) =>
    store.starStoriesRepo.create(
      candidate.id,
      randomUUID(),
      {
        title,
        sourceFactIds: [],
        fields: { situation: 'Ушёл ведущий инженер', task: '', action: 'Перераспределил', result: 'Релиз вышел в срок' },
      },
      '2026-11-01T00:00:00.000Z',
    );
  const messages = async (query: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/candidate/me/messages?${query}`,
        headers: { authorization, origin: 'http://localhost:3000' },
      })
    ).json().data as { role: string; content: string }[];
  return { seen, seenOptions, turn, addStory, messages };
}

describe('разговор о вакансии (B608)', () => {
  async function twoVacancies() {
    const context = await harness();
    const about = (id: string, content: string) =>
      context.turn({ content, stage: 'vacancies', subject: { kind: 'vacancy', id } });
    await about(VACANCY.id, 'Вопрос про первую вакансию');
    await about(OTHER_VACANCY.id, 'Вопрос про вторую вакансию');
    return context;
  }
  const said = (rows: readonly { role: string; content: string }[]) =>
    rows.filter((row) => row.role === 'user').map((row) => row.content);

  it('модель читает только разговор этой вакансии', async () => {
    const { seen } = await twoVacancies();
    // Сводка закрытого разговора читает его целиком: это не ответ кандидату.
    const second = seen.filter(
      (input) => !input.internalPurpose && said(input.messages).includes('Вопрос про вторую вакансию'),
    );
    expect(second.length).toBeGreaterThan(0);
    second.forEach((input) => expect(said(input.messages)).toEqual(['Вопрос про вторую вакансию']));
  });

  it('лента вакансии отдаёт только её реплики, разговор другой остаётся на месте', async () => {
    const { messages } = await twoVacancies();
    const vacancy = (id: string) => `stage=vacancies&vacancy=${encodeURIComponent(id)}`;
    expect(said(await messages(vacancy(VACANCY.id)))).toEqual(['Вопрос про первую вакансию']);
    expect(said(await messages(vacancy(OTHER_VACANCY.id)))).toEqual(['Вопрос про вторую вакансию']);
    expect(said(await messages('stage=vacancies'))).toEqual([
      'Вопрос про первую вакансию',
      'Вопрос про вторую вакансию',
    ]);
  });

  it('ход без вакансии по-прежнему читает весь этап', async () => {
    const { seen, turn } = await twoVacancies();
    await turn({ content: 'Что подобрать ещё?', stage: 'vacancies' });
    const general = seen.find((input) => said(input.messages).includes('Что подобрать ещё?'));
    expect(said(general?.messages ?? [])).toHaveLength(3);
  });
});

describe('контекст хода консультанта', () => {
  it('ход получает STAR-историю кандидата, и она доходит до модели', async () => {
    const { seen, turn, addStory } = await harness();
    addStory('Кризис в команде');
    const response = await turn({ content: 'Добавь фразу про кризис', stage: 'vacancies' });
    expect(response.statusCode).toBe(200);
    const stories = seen[0]?.knowledgeContext?.starStories ?? [];
    expect(stories.map((story) => story.title)).toEqual(['Кризис в команде']);
    expect(coachTurnInputSchema.parse(seen[0]).knowledgeContext?.starStories).toHaveLength(1);
    expect(serializeCoachInput(seen[0] as CoachTurnInput)).toContain('Кризис в команде');
  });

  it('ход просит у очереди моделей законченную реплику', async () => {
    const { seenOptions, turn } = await harness();
    await turn({ content: 'Что поправить в письме?', stage: 'vacancies' });
    expect(seenOptions[0]?.prefer).toBe(preferFinishedReply);
  });

  it('без историй поле пустое: модель не получает выдуманного', async () => {
    const { seen, turn } = await harness();
    await turn({ content: 'Есть ли история про кризис?', stage: 'vacancies' });
    expect(seen[0]?.knowledgeContext?.starStories).toEqual([]);
    // Пустой список виден модели: это текущее состояние, а не отсутствие данных.
    expect(serializeCoachInput(seen[0] as CoachTurnInput)).toContain('"starStories":[]');
  });

  it('служебный ход и дневник истории не получают', async () => {
    const { seen, turn, addStory } = await harness();
    addStory('Кризис в команде');
    await turn({ content: 'Проверь требование', stage: 'vacancies', isService: true });
    expect(seen[0]?.knowledgeContext?.starStories ?? []).toEqual([]);
  });

  it('черновик письма с экрана идёт в контекст вакансии как недоверенные данные', async () => {
    const { seen, turn } = await harness();
    const response = await turn({
      content: 'Письмо суховато',
      stage: 'vacancies',
      subject: { kind: 'vacancy', id: VACANCY.id },
      screenDraft: 'Здравствуйте! Сократил релиз с 14 до 3 дней.',
    });
    expect(response.statusCode).toBe(200);
    expect(seen[0]?.stageContext).toContain('Сократил релиз с 14 до 3 дней');
    expect(seen[0]?.stageContext).toContain('Вакансия: Начальник отдела поддержки');
    expect(seen[0]?.stageContext).toContain('недоверенные');
  });

  it('черновик без вакансии отбрасывается: письма в разговоре нет', async () => {
    const { seen, turn } = await harness();
    await turn({ content: 'Письмо суховато', stage: 'vacancies', screenDraft: 'Текст письма' });
    expect(seen[0]?.stageContext ?? '').not.toContain('Текст письма');
  });
});
