import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { CareerStrategy } from '../../shared/careerStrategy';
import { createCandidate, createStore } from '../data/sqliteTestHarness';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { config } from '../appTestHarness';
import type { RouteDeps } from './deps';
import { registerRoleSkillAssessmentRoutes } from './roleSkillAssessmentRoutes';

const ROLE_TITLE = 'Head of Product';
const OBSERVED_AT = new Date(Date.now() - 86_400_000).toISOString();
const START_PATH = '/api/v1/candidate/role-skill-assessments/start';
const ORIGIN = config.allowedOrigins[0] ?? 'http://localhost:3000';
const ROLE_SKILLS = [
  'Product discovery',
  'Unit economics',
  'SQL analytics',
  'A/B testing',
  'Stakeholder management',
];

const STRATEGY = {
  current: {
    version: 1,
    role: {
      title: ROLE_TITLE,
      origin: 'model',
      reason: 'r',
      evidenceRefs: [],
      confirmation: { state: 'too-few', sampleSize: 3 },
    },
    constraints: { regions: [], note: null },
    reason: 'r',
    decidedAt: OBSERVED_AT,
    provenance: { namedBy: 'test', language: 'ru', poolSize: 8 },
  },
  history: [],
} as unknown as CareerStrategy;

function vacancies(count: number): MatchedVacancyItem[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `fixture-vacancy-${index}`;
    return {
      cluster: {
        id,
        canonicalTitle: ROLE_TITLE,
        canonicalCompany: `Employer ${index}`,
        canonicalLocation: 'Москва',
        isRemote: true,
        descriptionSummary: 'Описание вакансии.',
        skills: ROLE_SKILLS,
        primaryUrl: `https://jobs.example.test/${id}`,
        sources: [
          {
            sourceType: 'rss',
            sourceId: `source-${index}`,
            sourceName: 'Fixture',
            sourceUrl: `https://jobs.example.test/${id}`,
            observedAt: OBSERVED_AT,
          },
        ],
        firstObservedAt: OBSERVED_AT,
        lastSeenAt: OBSERVED_AT,
        status: 'active',
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: id,
        roleMatch: 'target',
        levelMatch: 'unknown',
        matchingPoints: [],
        missingPoints: [],
        summary: 's',
        calculatedAt: OBSERVED_AT,
      },
    } as unknown as MatchedVacancyItem;
  });
}

const requirement = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance: 'high',
  kind: 'other',
  hard: false,
  stopFactor: false,
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function rig(poolSize = 8, withStrategy = true) {
  const store = createStore();
  const candidate = createCandidate(store);
  if (withStrategy) store.saveCareerStrategy(candidate.id, STRATEGY);
  const pool = vacancies(poolSize);
  const deps = {
    config,
    authService: {
      authenticate: vi.fn((token: string) => {
        const identity = store.authenticate(token);
        return identity
          ? { userId: identity.id, role: 'candidate' as const, candidate: identity }
          : null;
      }),
    },
    candidateStore: store,
    multiSourceEngine: {
      getMatchedVacanciesAsync: vi.fn(async () => pool),
      getActiveCluster: (id: string) => pool.find((item) => item.cluster.id === id)?.cluster,
    },
    vacancyMechanics: {
      requirements: {
        getLatest: (id: string) =>
          id === 'fixture-vacancy-0'
            ? { requirements: [requirement('r1', 'SQL analytics'), requirement('r2', 'Kafka')] }
            : null,
      },
    },
  } as unknown as RouteDeps;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // Mirrors the app-wide handler (routes/runtime.ts): an invalid body is 422.
  app.setErrorHandler((error, _request, reply) =>
    reply.status(error instanceof ZodError ? 422 : 500).send({ error: { code: 'invalid' } }),
  );
  registerRoleSkillAssessmentRoutes(app, deps);
  apps.push(app);
  const start = (focus: unknown, role?: string) =>
    app.inject({
      method: 'POST',
      url: START_PATH,
      headers: { authorization: `Bearer ${candidate.accessToken}`, origin: ORIGIN },
      payload: { consent: true, ...(role ? { role } : {}), focus },
    });
  return { start };
}

describe('role skill check focused on a vacancy (B552)', () => {
  it('builds cases only for the vacancy skills and says «мало данных» for the rest', async () => {
    const { start } = await rig();
    const response = await start({
      vacancyId: 'fixture-vacancy-0',
      skills: ['sql analytics', 'Kafka'],
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.state).toBe('run');
    expect(
      data.run.cases.map(
        (item: { assessmentCase: { skillName: string } }) => item.assessmentCase.skillName,
      ),
    ).toEqual(['SQL analytics', 'Kafka']);
    expect(data.run.skills).toHaveLength(5);
    expect(data.run.focus).toMatchObject({
      vacancyId: 'fixture-vacancy-0',
      skills: ['SQL analytics', 'Kafka'],
      sampleRoleTitle: ROLE_TITLE,
      roleNote: null,
      lackingNotes: [],
    });
  });

  it('builds the vacancy quiz without the role-wide «five skills, three cases» gate (G5 R1b)', async () => {
    const { start } = await rig(1);
    const response = await start({ vacancyId: 'fixture-vacancy-0', skills: ['Kafka'] });
    const data = response.json().data;
    expect(data.state).toBe('run');
    expect(
      data.run.cases.map(
        (item: { assessmentCase: { skillName: string } }) => item.assessmentCase.skillName,
      ),
    ).toEqual(['Kafka']);
  });

  it('starts the vacancy quiz on the requested role when no «Стратегия» is chosen (block C B552)', async () => {
    const { start } = await rig(8, false);
    const response = await start({ vacancyId: 'fixture-vacancy-0', skills: ['Kafka'] }, ROLE_TITLE);
    const data = response.json().data;
    expect(data.state).toBe('run');
    expect(data.run.roleTitle).toBe(ROLE_TITLE);
  });

  it('rejects a skill that is not a requirement of this vacancy', async () => {
    const { start } = await rig();
    const response = await start({ vacancyId: 'fixture-vacancy-0', skills: ['Rust'] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('focus_skill_not_in_vacancy');
  });

  it('rejects an unknown vacancy (404) and more than three skills (422)', async () => {
    const { start } = await rig();
    expect((await start({ vacancyId: 'missing', skills: ['Kafka'] })).statusCode).toBe(404);
    expect(
      (await start({ vacancyId: 'fixture-vacancy-0', skills: ['a', 'b', 'c', 'd'] })).statusCode,
    ).toBe(422);
  });
});
