import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { CoachProviderError, type CoachProvider } from './coachProvider';
import { ResilientCoachProvider } from './resilientCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Тестовый вопрос' }],
};

describe('ResilientCoachProvider', () => {
  it('cools a rate-limited provider and returns visible fallback provenance', async () => {
    let primaryCalls = 0;
    const primary: CoachProvider = {
      async createTurn() {
        primaryCalls += 1;
        throw new CoachProviderError('provider_rate_limited', 429, true);
      },
    };
    const fallback: CoachProvider = {
      async createTurn() {
        return result('nvidia');
      },
    };
    const provider = new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', provider: primary },
        { id: 'nvidia', provider: fallback },
      ],
      cooldownMs: 60_000,
      now: () => 1_000,
    });

    const first = await provider.createTurn(
      input,
      '55555555-5555-4555-8555-555555555555',
    );
    const second = await provider.createTurn(
      input,
      '66666666-6666-4666-8666-666666666666',
    );

    expect(primaryCalls).toBe(1);
    expect(first.routing).toMatchObject({
      fallbackUsed: true,
      attempts: [
        { provider: 'openrouter', status: 'failed', code: 'provider_rate_limited' },
        { provider: 'nvidia', status: 'succeeded' },
      ],
    });
    expect(second.routing?.attempts[0]).toMatchObject({
      provider: 'openrouter',
      status: 'skipped',
      code: 'provider_cooldown',
    });
  });
});

function result(provider: 'nvidia') {
  return {
    provider,
    model: 'nvidia/nemotron-3-super-120b-a12b',
    responseId: 'response-fallback',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    result: {
      message: 'Fallback response',
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

/**
 * B183. На проде это стоило хода коуча: в пуле оказался провайдер, отвергавший
 * наш контракт вывода (`400`), и его неповторяемая ошибка обрывала цепочку —
 * следующий маршрут, который ответил бы, даже не пробовали. Пул существует
 * ровно для этого случая.
 */
describe('несовместимый провайдер в пуле (B183)', () => {
  it('переходит к следующему маршруту и после неповторяемой ошибки', async () => {
    const rejecting: CoachProvider = {
      async createTurn() {
        throw new CoachProviderError('provider_unavailable', 502, false);
      },
    };
    const answering: CoachProvider = {
      async createTurn() {
        return {
          ...result('nvidia'),
          provider: 'openrouter' as const,
          model: 'openrouter/free',
          responseId: 'answered',
        };
      },
    };

    const outcome = await new ResilientCoachProvider({
      routes: [
        { id: 'gemini', provider: rejecting },
        { id: 'openrouter', provider: answering },
      ],
    }).createTurn(input, 'idempotency-key');

    expect(outcome.responseId).toBe('answered');
    expect(outcome.routing?.fallbackUsed).toBe(true);
    expect(outcome.routing?.attempts).toEqual([
      { provider: 'gemini', status: 'failed', code: 'provider_unavailable' },
      { provider: 'openrouter', status: 'succeeded' },
    ]);
  });

  it('когда отказали все, поднимает последнюю ошибку, а не молчит', async () => {
    const rejecting: CoachProvider = {
      async createTurn() {
        throw new CoachProviderError('provider_unavailable', 502, false);
      },
    };

    await expect(
      new ResilientCoachProvider({
        routes: [
          { id: 'gemini', provider: rejecting },
          { id: 'openrouter', provider: rejecting },
        ],
      }).createTurn(input, 'idempotency-key'),
    ).rejects.toBeInstanceOf(CoachProviderError);
  });
});

/**
 * B183. Владелец назвал очередь из трёх моделей, две из которых живут за
 * `openrouter`. Если остывание считать по провайдеру, отказ первой из них
 * вычеркнет и вторую — очередь схлопнется там, где должна была продолжиться.
 */
describe('две ступени одного провайдера (B183)', () => {
  it('остывают независимо и различимы в провенансе по модели', async () => {
    const failing: CoachProvider = {
      async createTurn() {
        throw new CoachProviderError('provider_rate_limited', 429, true);
      },
    };
    const answering: CoachProvider = {
      async createTurn() {
        return { ...result('nvidia'), provider: 'openrouter' as const, model: 'openrouter/free' };
      },
    };

    const outcome = await new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: failing },
        { id: 'openrouter', model: 'openrouter/free', provider: answering },
      ],
    }).createTurn(input, 'idempotency-key');

    expect(outcome.routing?.attempts).toEqual([
      {
        provider: 'openrouter',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        status: 'failed',
        code: 'provider_rate_limited',
      },
      { provider: 'openrouter', model: 'openrouter/free', status: 'succeeded' },
    ]);
  });
});
