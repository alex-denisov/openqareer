import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CoachProviderError, type CoachProvider } from './providers/coachProvider';
import {
  candidateAuthorization,
  config,
  createApp,
  successProvider,
  validPayload,
} from './appTestHarness';

describe('OpenQareer API boundary', () => {
  it('delegates a permitted profile transport only inside the candidate boundary', async () => {
    const app = await createApp(successProvider, undefined, async (url) => ({
      status: 'imported',
      platform: 'linkedin',
      sourceUrl: url,
      capturedAt: '2026-08-10T00:00:00.000Z',
      accessPath: 'official_api',
      facts: [
        {
          kind: 'headline',
          value: 'Synthetic Product Lead',
          sourceLocator: 'public-meta:1',
          confidence: 'public-metadata',
        },
      ],
    }));
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/profile-imports',
      headers: { origin: 'http://localhost:3000' },
      payload: { url: 'https://www.linkedin.com/in/synthetic-candidate' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/profile-imports',
      headers: {
        origin: 'http://localhost:3000',
        authorization: candidateAuthorization(app),
      },
      payload: { url: 'https://www.linkedin.com/in/synthetic-candidate' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'imported',
      facts: [{ value: 'Synthetic Product Lead' }],
    });
  });

  it('returns a source-labelled public vacancy sample without candidate credentials', async () => {
    const app = await createApp(successProvider, async () => ({
      source: 'hh',
      query: 'руководитель операций',
      found: 18,
      fetchedAt: '2026-08-07T13:00:00.000Z',
      items: [],
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/market/hh?text=руководитель%20операций',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        source: 'hh',
        found: 18,
        fetchedAt: '2026-08-07T13:00:00.000Z',
      },
    });
  });

  it('separates a closed hh.ru search from a temporary outage (B175, INC-022)', async () => {
    const app = await createApp(successProvider, async () => {
      throw new Error('hh_vacancy_search_official_access_required');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/market/hh?text=qa',
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error.code).toBe('market_source_official_access_required');
    expect(body.error.message).not.toContain('Попробуйте позже');
    expect(body.error.retryable).toBe(false);
  });

  it('keeps health public and provider details authenticated', async () => {
    const app = await createApp();

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      data: { status: 'ok', release: 'test-release' },
    });

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error).toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: {
        authorization: `Bearer ${config.previewToken}`,
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().data).toMatchObject({
      // Очередь называет модель, а не только провайдера: две её ступени могут
      // жить за одним провайдером (B183).
      personalDataRoute: {
        provider: 'openai',
        model: 'gpt-5.6-sol',
        fallbackModels: [],
      },
      syntheticDataRoute: {
        provider: 'openrouter',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        fallbackModels: [],
        outputValidation: 'server-side-strict-schema',
      },
      qualityFloor: 'gpt-5.6-sol',
      promptRevision: 'career-v1.0-2026-08-07',
    });
  });

  it('validates idempotency and input before calling the model', async () => {
    const app = await createApp();
    const headers = {
      authorization: candidateAuthorization(app),
    };

    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers,
      payload: validPayload,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe('idempotency_key_required');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        ...headers,
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: '',
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error).toMatchObject({
      code: 'validation_failed',
      retryable: false,
    });
  });

  it('returns structured coach output and provider provenance', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        message: 'Уточним результат запуска.',
        phase: 'evidence',
      },
      meta: {
        provider: 'openai',
        model: 'gpt-5.6-sol',
        responseId: 'response-1',
      },
    });
  });

  it('keeps phase selection on the server instead of trusting the browser', async () => {
    let providerPhase: string | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        providerPhase = input.phase;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const app = await createApp(provider);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: { ...validPayload, phase: 'targeting' },
    });

    expect(response.statusCode).toBe(200);
    expect(providerPhase).toBe('discovery');
  });

  it('routes an explicit market request into the material three-role phase', async () => {
    let providerPhase: string | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        providerPhase = input.phase;
        return successProvider.createTurn(input, randomUUID());
      },
    };
    const app = await createApp(provider);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Сравни рынок вакансий в Германии и России',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(providerPhase).toBe('market');
  });

  it('returns a stable retryable error without provider payloads', async () => {
    const provider: CoachProvider = {
      async createTurn() {
        throw new CoachProviderError('provider_rate_limited', 429, true);
      },
    };
    const app = await createApp(provider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        authorization: candidateAuthorization(app),
        'idempotency-key': randomUUID(),
      },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
    });
    expect(response.json().error.message).not.toBe('limited');

    // Диалог не едет в снимке: целиком снимок не доезжает до браузера, и
    // сообщения читаются отдельной страницей (INC-030).
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me/messages',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(snapshot.json().data).toEqual([
      {
        id: validPayload.messageId,
        role: 'user',
        content: validPayload.content,
      },
    ]);
  });

  it('creates one-time candidate credentials and isolates profiles', async () => {
    const app = await createApp();
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/candidates',
      payload: { dataClass: 'synthetic', locale: 'ru-RU' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidates',
      headers: {
        authorization: `Bearer ${config.previewToken}`,
      },
      payload: { dataClass: 'synthetic', locale: 'ru-RU' },
    });
    expect(created.statusCode).toBe(201);
    const credentials = created.json().data as {
      id: string;
      accessToken: string;
    };
    expect(credentials.accessToken).toMatch(/^oqc_/);

    const ownSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
      },
    });
    expect(ownSnapshot.statusCode).toBe(200);
    expect(ownSnapshot.json().data).toMatchObject({
      candidate: { id: credentials.id },
      messages: [],
      memory: [],
    });

    const otherSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(otherSnapshot.json().data.candidate.id).not.toBe(credentials.id);
  });

  it('evaluates, stores and replaces candidate-scoped assessments', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const preferences = {
      ambiguity: 5,
      evidence: 5,
      collaboration: 4,
      persuasion: 2,
      planning: 3,
      detail: 2,
      leadership: 3,
      craft: 4,
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/work-preferences-v1',
      headers: { authorization },
      payload: preferences,
    });
    expect(first.statusCode).toBe(200);
    const firstAssessment = first.json().data;
    expect(firstAssessment).toMatchObject({
      assessmentId: 'work-preferences-v1',
      result: { kind: 'work-preferences' },
    });
    expect(firstAssessment.result.roleFamilies[0].id).toBe('product-discovery');

    const revised = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/work-preferences-v1',
      headers: { authorization },
      payload: { ...preferences, planning: 5 },
    });
    expect(revised.statusCode).toBe(200);
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    expect(snapshot.json().data.assessments).toHaveLength(1);
    expect(snapshot.json().data.assessments[0].submission.planning).toBe(5);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/assessments/product-case-v1',
      headers: { authorization },
      payload: { firstMove: 'invent-the-answer' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('evaluates and returns a dated Germany route without eligibility claims', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/markets/DE',
      headers: { authorization },
      payload: {
        workAuthorization: 'none',
        jobOffer: 'yes',
        grossAnnualSalaryEur: 55_000,
        offerDurationMonths: 24,
        qualification: 'recognized-comparable',
        professionRegulation: 'non-regulated',
        blueCardBand: 'general',
        fundsMonthlyEur: null,
        languageEvidence: 'english-b2-plus',
        relocationReadiness: 'ready',
        dependants: 'none',
        targetWorkMode: 'hybrid',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      country: 'DE',
      result: {
        packVersion: 'DE-2026.1',
        recommendedRouteId: 'eu-blue-card',
      },
    });
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    expect(snapshot.json().data.germanyMarket.result.caveat).toMatch(/не юридическое решение/i);
  });
});

