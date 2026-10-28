import { describe, expect, it } from 'vitest';
import { CoachProviderError } from './coachProvider';
import { buildCoachChainProvider, chainRoutes, chainStageLabel, MODEL_CHAINS } from './modelChains';
import { isMutableModelAlias } from './modelRegistry';

const labels = (mechanic: keyof typeof MODEL_CHAINS) => MODEL_CHAINS[mechanic].map(chainStageLabel);

describe('цепочки моделей по механикам (28.10)', () => {
  it('консультант: OpenAI luna → deepseek-v4.1-flash → glm-5.3-flash', () => {
    expect(labels('coach')).toEqual([
      'openai:gpt-5.6-luna',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
  });

  it('фоновая обработка: Vertex → deepseek-v4.1-flash → glm-5.3-flash', () => {
    expect(labels('bulk')).toEqual([
      'vertex',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
  });

  it('разбор резюме — только платные маршруты', () => {
    expect(labels('resumeParsing')).toEqual(labels('coach'));
  });

  it('тексты для человека: Vertex → deepseek-v4.1-flash → luna', () => {
    for (const mechanic of ['roleNames', 'coverLetters', 'linkedinDrafts'] as const) {
      expect(labels(mechanic)).toEqual([
        'vertex',
        'openrouter:deepseek/deepseek-v4.1-flash',
        'openai:gpt-5.6-luna',
      ]);
    }
  });

  it('структурный JSON: Vertex → deepseek-v4.1-flash → glm-5.3-flash', () => {
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
    const failing = new Set(['gpt-5.6-luna', 'deepseek/deepseek-v4.1-flash']);
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
      { provider: 'openai', model: 'gpt-5.6-luna', status: 'failed' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', status: 'failed' },
      { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', status: 'succeeded' },
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
