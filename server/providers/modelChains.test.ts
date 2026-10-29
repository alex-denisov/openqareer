import { describe, expect, it } from 'vitest';
import { CoachProviderError } from './coachProvider';
import { buildCoachChainProvider, chainRoutes, chainStageLabel, MODEL_CHAINS } from './modelChains';
import { isMutableModelAlias } from './modelRegistry';

const labels = (mechanic: keyof typeof MODEL_CHAINS) => MODEL_CHAINS[mechanic].map(chainStageLabel);

describe('цепочки моделей по механикам (28.10)', () => {
  it('консультант платных тарифов: deepseek-v4.1-flash-1017 → deepseek-v4.1-flash → luna (B580)', () => {
    expect(labels('coach')).toEqual([
      'openrouter:deepseek/deepseek-v4.1-flash-1017',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openai:gpt-5.6-luna',
    ]);
  });

  it('консультант Free: glm-5.3-flash с запасной deepseek-v4.1-flash (B579)', () => {
    expect(labels('coachFree')).toEqual([
      'openrouter:z-ai/glm-5.3-flash',
      'openrouter:deepseek/deepseek-v4.1-flash',
    ]);
  });

  it('фоновая обработка: deepseek-v4-flash → glm-5.3-flash → Vertex (B580: Vertex последним)', () => {
    expect(labels('bulk')).toEqual([
      'openrouter:deepseek/deepseek-v4-flash',
      'openrouter:z-ai/glm-5.3-flash',
      'vertex',
    ]);
  });

  it('разбор резюме — только платные маршруты, luna первой', () => {
    expect(labels('resumeParsing')).toEqual([
      'openai:gpt-5.6-luna',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
  });

  it('тексты для человека: deepseek-v4.1-flash → luna → Vertex', () => {
    for (const mechanic of ['roleNames', 'coverLetters', 'linkedinDrafts'] as const) {
      expect(labels(mechanic)).toEqual([
        'openrouter:deepseek/deepseek-v4.1-flash',
        'openai:gpt-5.6-luna',
        'vertex',
      ]);
    }
  });

  it('структурный JSON: как фон — deepseek-v4-flash → glm-5.3-flash → Vertex', () => {
    for (const mechanic of ['campaignRoles', 'titleParsing'] as const) {
      expect(labels(mechanic)).toEqual(labels('bulk'));
    }
  });

  it.each(Object.keys(MODEL_CHAINS) as Array<keyof typeof MODEL_CHAINS>)(
    '%s: не меньше двух ступеней, без бесплатных, мёртвых и дорогих маршрутов',
    (mechanic) => {
      const chain = labels(mechanic);
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(new Set(chain).size).toBe(chain.length);
      for (const label of chain) {
        expect(label).not.toMatch(/:free$|openrouter\/free|^gemini:|^anthropic:|claude-fable/u);
        expect(isMutableModelAlias(label.slice(label.indexOf(':') + 1))).toBe(false);
      }
    },
  );

  it('маршруты строятся только из названных ступеней с ключом, без хвоста', () => {
    const routes = chainRoutes(MODEL_CHAINS.coach, {
      openai: 'sk-openai-test-key-long-enough',
      openrouter: 'sk-or-test-key-long-enough',
      nvidia: 'nvapi-test-key-long-enough',
      anthropic: 'sk-ant-test-key-long-enough',
    });
    expect(routes.map((route) => `${route.provider}:${route.model}`)).toEqual(labels('coach'));
  });

  it('ступень без ключа пропускается, остальные сохраняют порядок', () => {
    const routes = chainRoutes(MODEL_CHAINS.roleNames, {
      openai: 'sk-openai-test-key-long-enough',
    });
    expect(routes.map((route) => route.model)).toEqual(['gpt-5.6-luna']);
  });
});

describe('очередь консультанта по цепочке', () => {
  const input = {
    candidateReference: 'candidate-test-001',
    dataClass: 'personal' as const,
    locale: 'ru-RU' as const,
    phase: 'discovery' as const,
    messages: [{ id: 'message-1', role: 'user' as const, content: 'Что дальше?' }],
  };
  const credentials = {
    openai: 'sk-openai-test-key-long-enough',
    openrouter: 'sk-or-test-key-long-enough',
  };

  it('отказ ступени ведёт к следующей по порядку цепочки', async () => {
    const failing = new Set(['deepseek/deepseek-v4.1-flash-1017', 'deepseek/deepseek-v4.1-flash']);
    const timeouts: number[] = [];
    const provider = buildCoachChainProvider({
      credentials,
      now: () => 1_000,
      buildStage: (route, timeoutMs) => {
        timeouts.push(timeoutMs);
        return {
          async createTurn() {
            if (failing.has(route.model)) {
              throw new CoachProviderError('provider_unavailable', 503, true);
            }
            return turnFrom(route.model);
          },
        };
      },
    });

    const output = await provider.createTurn(input, '11111111-1111-4111-8111-111111111111');

    expect(output.routing?.attempts).toMatchObject([
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', status: 'failed' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', status: 'failed' },
      { provider: 'openai', model: 'gpt-5.6-luna', status: 'succeeded' },
    ]);
    // Последней ступени некому уступить ход — её потолок длиннее.
    expect(timeouts[2]).toBeGreaterThan(timeouts[0]);
  });

  it('первая ступень отвечает — остальные не вызываются', async () => {
    const called: string[] = [];
    const provider = buildCoachChainProvider({
      credentials,
      buildStage: (route) => ({
        async createTurn() {
          called.push(route.model);
          return turnFrom(route.model);
        },
      }),
    });

    await provider.createTurn(input, '22222222-2222-4222-8222-222222222222');

    expect(called).toEqual(['deepseek/deepseek-v4.1-flash-1017']);
  });

  it('ход Free идёт по цепочке Free, платный — по платной (B579)', async () => {
    const called: string[] = [];
    const provider = buildCoachChainProvider({
      credentials,
      buildStage: (route) => ({
        async createTurn() {
          called.push(route.model);
          return turnFrom(route.model);
        },
      }),
    });

    await provider.createTurn(
      { ...input, modelTier: 'free' },
      '33333333-3333-4333-8333-333333333333',
    );
    await provider.createTurn(input, '44444444-4444-4444-8444-444444444444');

    expect(called).toEqual(['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash-1017']);
  });

  it('без ключа OpenRouter ход Free идёт по платной цепочке, а не роняет запуск (B579)', async () => {
    const called: string[] = [];
    const provider = buildCoachChainProvider({
      credentials: { openai: credentials.openai },
      buildStage: (route) => ({
        async createTurn() {
          called.push(route.model);
          return turnFrom(route.model);
        },
      }),
    });

    await provider.createTurn({ ...input, modelTier: 'free' }, '55555555-5555-4555-8555-555555555555');

    expect(called).toEqual(['gpt-5.6-luna']);
  });
});

function turnFrom(model: string) {
  return {
    provider: 'openai' as const,
    model,
    responseId: `response-${model}`,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    result: {
      message: `Ответ ${model}`,
      phase: 'discovery' as const,
      memoryCandidates: [],
      nextQuestion: 'Что уточнить?',
      completeness: { known: [], unknown: ['Цель'] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
    },
  };
}
