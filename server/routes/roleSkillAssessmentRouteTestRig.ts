// Shared rig for the B461 role skill assessment route tests.
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, expect, vi } from 'vitest';
import type { CareerStrategy } from '../../shared/careerStrategy';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import type { CoachTurnInput } from '../domain/coach';
import { createCandidate, createStore, output } from '../data/sqliteTestHarness';
import type { CoachProviderResult } from '../providers/coachProvider';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { config } from '../appTestHarness';
import type { RouteDeps } from './deps';
import { registerRoleSkillAssessmentRoutes } from './roleSkillAssessmentRoutes';

export const ROLE_TITLE = 'Head of Product';
export const OBSERVED_AT = '2026-10-09T12:00:00.000Z';
export const DIALOGUE_ANSWERS = [
  'Провела 12 интервью и выделила три устойчивых сценария для клиентов.',
  'Проверила unit-экономику сегмента и согласовала измеримые критерии решения.',
  'Сверила конверсию с контрольной группой до запуска на всю аудиторию.',
] as const;
export const CASE_ANSWER =
  'Сначала проверила стоимость операций, затем сравнила конверсию с контрольной группой.';
export const CURRENT_PATH = '/api/v1/candidate/role-skill-assessments/current';
export const START_PATH = '/api/v1/candidate/role-skill-assessments/start';
export const BASE_PATH = '/api/v1/candidate/role-skill-assessments';
export const ORIGIN = config.allowedOrigins[0] ?? 'http://localhost:3000';

const TEST_STRATEGY: CareerStrategy = {
  current: {
    version: 2,
    role: {
      title: ROLE_TITLE,
      origin: 'model',
      reason: 'Руководство продуктовой командой и ответственностью за результат.',
      evidenceRefs: ['memory:role-fixture'],
      confirmation: { state: 'too-few', sampleSize: 3 },
    },
    constraints: { regions: ['ru'], note: null },
    reason: 'Проверка навыков для выбранной роли.',
    decidedAt: OBSERVED_AT,
    provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'ru', poolSize: 8 },
  },
  history: [],
};

const SUGGESTION_JSON = JSON.stringify({
  suggestions: Array.from({ length: 12 }, (_, index) => {
    const sourceAnswerIndex = index % DIALOGUE_ANSWERS.length;
    const sourceExcerpt = [
      'Провела 12 интервью',
      'Проверила unit-экономику',
      'Сверила конверсию с контрольной группой',
    ][sourceAnswerIndex]!;
    return {
      domain: 'skill',
      statement: `Подтверждённый факт роли ${index + 1}.`,
      sourceExcerpt,
      sourceAnswerIndex,
    };
  }),
});

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.close();
});

function matchedVacancies(
  count: number,
  title = ROLE_TITLE,
  withClusterSkills = true,
): MatchedVacancyItem[] {
  return Array.from({ length: count }, (_, index) => {
    const clusterId = `fixture-vacancy-${index}`;
    const cluster: MatchedVacancyItem['cluster'] = {
      id: clusterId,
      canonicalTitle: title,
      canonicalCompany: `Fixture employer ${index}`,
      canonicalLocation: 'Москва',
      isRemote: true,
      descriptionSummary: 'Требования к продуктовой стратегии, аналитике и результатам команды.',
      skills: withClusterSkills
        ? [
            'Product discovery',
            'Unit economics',
            'SQL analytics',
            'A/B testing',
            'Stakeholder management',
          ]
        : [],
      primaryUrl: `https://jobs.example.test/${clusterId}`,
      sources: [
        {
          sourceType: 'rss',
          sourceId: `fixture-source-${index}`,
          sourceName: 'Synthetic vacancy fixture',
          sourceUrl: `https://jobs.example.test/${clusterId}`,
          observedAt: OBSERVED_AT,
        },
      ],
      firstObservedAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT,
      status: 'active',
      vacanciesCount: 1,
    };
    const explanation = {
      clusterId,
      roleMatch: 'target',
      levelMatch: 'unknown',
      matchingPoints: ['Product discovery'],
      missingPoints: [],
      summary: 'Synthetic requirement fixture for the selected role.',
      calculatedAt: OBSERVED_AT,
    } as unknown as MatchedVacancyItem['explanation'];
    return { cluster, explanation };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstSourceRefId(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = firstSourceRefId(item);
      if (id) return id;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (Array.isArray(value.sourceRefs)) {
    for (const source of value.sourceRefs) {
      if (isRecord(source) && typeof source.id === 'string') return source.id;
    }
  }
  for (const nested of Object.values(value)) {
    const id = firstSourceRefId(nested);
    if (id) return id;
  }
  return null;
}

function providerResult(
  message: string,
  memoryCandidates: CoachProviderResult['result']['memoryCandidates'] = [],
): CoachProviderResult {
  return {
    ...output,
    result: {
      ...output.result,
      message,
      memoryCandidates,
      actionProposals: [],
    },
  };
}

interface FakeProviderOptions {
  readonly failFirstCall?: boolean;
  readonly suggestionJson?: string;
  /** Facts a coach model files as memory candidates instead of the requested JSON (B564). */
  readonly suggestionMemory?: (
    answerIds: readonly string[],
  ) => CoachProviderResult['result']['memoryCandidates'];
}

function createFakeProvider(options: FakeProviderOptions = {}) {
  let callCount = 0;
  const createTurn = vi.fn(async (input: CoachTurnInput, _idempotencyKey: string) => {
    callCount += 1;
    if (options.failFirstCall && callCount === 1) throw new Error('synthetic provider outage');
    if ((input.stageContext ?? '').includes('profile suggestions')) {
      const answerIds = input.messages.map((message) => message.id);
      return providerResult(
        options.suggestionJson ?? SUGGESTION_JSON,
        options.suggestionMemory?.(answerIds),
      );
    }

    const stageContextText = input.stageContext ?? '';
    if (stageContextText.includes('Explain the case condition')) {
      return providerResult('Кейс проверяет, как вы обосновываете решение данными.');
    }
    const stageContext = JSON.parse(stageContextText) as unknown;
    const sourceRefId = firstSourceRefId(stageContext);
    if (!sourceRefId) throw new Error('evaluation prompt omitted case source refs');
    return providerResult(
      JSON.stringify({
        grade: 'partial',
        criteria: [
          {
            criterionId: 'context',
            grade: 'confirmed',
            explanation: 'Ответ называет контекст решения.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
          {
            criterionId: 'actions',
            grade: 'confirmed',
            explanation: 'Ответ описывает сравнение двух показателей.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
          {
            criterionId: 'verification',
            grade: 'partial',
            explanation: 'Не указан численный результат проверки.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
        ],
      }),
    );
  });
  return { createTurn };
}

interface RigOptions {
  readonly withClusterSkills?: boolean;
  readonly extraDeps?: Partial<RouteDeps>;
  readonly engine?: Record<string, unknown>;
  readonly suggestionJson?: string;
  readonly suggestionMemory?: FakeProviderOptions['suggestionMemory'];
}

function cookieAuthService(
  store: ReturnType<typeof createStore>,
  cookieSessions: ReadonlyMap<string, ReturnType<typeof createCandidate>>,
) {
  return {
    authenticate: vi.fn((token: string) => {
      const cookieCandidate = cookieSessions.get(token);
      const identity = cookieCandidate
        ? store.authenticate(cookieCandidate.accessToken)
        : store.authenticate(token);
      return identity
        ? { userId: identity.id, role: 'candidate' as const, candidate: identity }
        : null;
    }),
  };
}

export async function createRig(
  initialVacancyCount = 8,
  failFirstProviderCall = false,
  options: RigOptions = {},
) {
  const store = createStore();
  const candidate = createCandidate(store);
  const otherCandidate = createCandidate(store);
  store.saveCareerStrategy(candidate.id, TEST_STRATEGY);
  const getMatchedVacanciesAsync = vi.fn(async (query: { targetRoles?: readonly string[] }) =>
    matchedVacancies(
      initialVacancyCount,
      query?.targetRoles?.[0] ?? ROLE_TITLE,
      options.withClusterSkills ?? true,
    ),
  );
  const provider = createFakeProvider({
    failFirstCall: failFirstProviderCall,
    suggestionJson: options.suggestionJson,
    suggestionMemory: options.suggestionMemory,
  });
  const cookieToken = `test-cookie-session-${candidate.id}`;
  const authService = cookieAuthService(store, new Map([[cookieToken, candidate]]));
  const deps = {
    config,
    authService,
    candidateStore: store,
    coachProvider: { createTurn: provider.createTurn },
    multiSourceEngine: { getMatchedVacanciesAsync, ...options.engine },
    ...options.extraDeps,
  } as unknown as RouteDeps;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerRoleSkillAssessmentRoutes(app, deps);
  apps.push(app);

  return {
    app,
    store,
    candidate,
    otherCandidate,
    cookieToken,
    provider,
    getMatchedVacanciesAsync,
  };
}

export function headersFor(candidate: Awaited<ReturnType<typeof createCandidate>>) {
  return { authorization: `Bearer ${candidate.accessToken}`, origin: ORIGIN };
}

export function mutationHeaders(
  rig: Awaited<ReturnType<typeof createRig>>,
  candidate = rig.candidate,
) {
  return headersFor(candidate);
}

export function responseData(response: { json(): unknown }): unknown {
  const body = response.json();
  return isRecord(body) ? body.data : undefined;
}

export function runFrom(response: { json(): unknown }): RoleSkillAssessmentRun {
  const data = responseData(response);
  if (isRecord(data)) {
    if (isRecord(data.run)) return data.run as unknown as RoleSkillAssessmentRun;
    if (isRecord(data.assessment)) return data.assessment as unknown as RoleSkillAssessmentRun;
  }
  if (isRecord(data)) return data as unknown as RoleSkillAssessmentRun;
  throw new Error('assessment response did not contain a run');
}

export async function startRun(rig: Awaited<ReturnType<typeof createRig>>) {
  const response = await rig.app.inject({
    method: 'POST',
    url: START_PATH,
    headers: mutationHeaders(rig),
    payload: { consent: true },
  });
  expect(response.statusCode).toBe(200);
  return runFrom(response);
}

export async function postDialogue(
  rig: Awaited<ReturnType<typeof createRig>>,
  run: RoleSkillAssessmentRun,
  answer: string,
  requestId = randomUUID(),
) {
  const payload = { expectedRevision: run.revision, requestId, answer };
  const response = await rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/dialogue`,
    headers: mutationHeaders(rig),
    payload,
  });
  return { payload, response };
}

export async function completeDialogue(
  rig: Awaited<ReturnType<typeof createRig>>,
  initialRun: RoleSkillAssessmentRun,
) {
  let run = initialRun;
  for (const answer of DIALOGUE_ANSWERS) {
    const { response } = await postDialogue(rig, run, answer);
    expect(response.statusCode).toBe(200);
    run = runFrom(response);
  }
  return run;
}

export async function decideSuggestions(
  rig: Awaited<ReturnType<typeof createRig>>,
  run: RoleSkillAssessmentRun,
  acceptedIds: ReadonlySet<string>,
) {
  return rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/suggestions`,
    headers: mutationHeaders(rig),
    payload: {
      expectedRevision: run.revision,
      requestId: randomUUID(),
      suggestions: run.suggestions.map((suggestion) => ({
        id: suggestion.id,
        accepted: acceptedIds.has(suggestion.id),
        statement: suggestion.statement,
      })),
    },
  });
}
