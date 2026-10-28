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
  it('moves on when the caller rejects an answer, without cooling that route (B564)', async () => {
    let primaryCalls = 0;
    const primary: CoachProvider = {
      async createTurn() {
        primaryCalls += 1;
        return result('openrouter');
      },
    };
    const fallback: CoachProvider = {
      async createTurn() {
        return result('openai');
      },
    };
    const provider = new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', provider: primary },
        { id: 'openai', provider: fallback },
      ],
      now: () => 1_000,
    });

    const strict = await provider.createTurn(input, '77777777-7777-4777-8777-777777777777', {
      accept: (answer) => answer.message.includes('openai'),
    });
    const plain = await provider.createTurn(input, '88888888-8888-4888-8888-888888888888');

    expect(strict.routing?.attempts).toMatchObject([
      { provider: 'openrouter', status: 'failed', code: 'provider_output_invalid' },
      { provider: 'openai', status: 'succeeded' },
    ]);
    expect(plain.routing?.attempts).toMatchObject([
      { provider: 'openrouter', status: 'succeeded' },
    ]);
    expect(primaryCalls).toBe(2);
  });

  it('fails as invalid output when no route gives an accepted answer', async () => {
    const provider = new ResilientCoachProvider({
      routes: [{ id: 'openrouter', provider: { createTurn: async () => result('openrouter') } }],
    });

    await expect(
      provider.createTurn(input, '99999999-9999-4999-8999-999999999999', { accept: () => false }),
    ).rejects.toMatchObject({ code: 'provider_output_invalid' });
  });

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

    const first = await provider.createTurn(input, '55555555-5555-4555-8555-555555555555');
    const second = await provider.createTurn(input, '66666666-6666-4666-8666-666666666666');

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

function result(provider: 'nvidia' | 'openrouter' | 'openai') {
  return {
    provider,
    model: 'nvidia/nemotron-3-super-120b-a12b',
    responseId: 'response-fallback',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    result: {
      message: `Fallback response from ${provider}`,
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

describe('ResilientCoachProvider: журнал отказа', () => {
  it('ошибка «отказали все» несёт попытки каждого маршрута', async () => {
    const rejecting = (code: 'provider_unavailable' | 'provider_timeout'): CoachProvider => ({
      async createTurn() {
        throw new CoachProviderError(code, 503, true);
      },
    });
    const failure = await new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', model: 'free', provider: rejecting('provider_timeout') },
        { id: 'openai', model: 'luna', provider: rejecting('provider_unavailable') },
      ],
    })
      .createTurn(input, 'idempotency-key')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CoachProviderError);
    expect((failure as CoachProviderError).attempts).toEqual([
      { provider: 'openrouter', model: 'free', status: 'failed', code: 'provider_timeout' },
      { provider: 'openai', model: 'luna', status: 'failed', code: 'provider_unavailable' },
    ]);
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

describe('время ступеней хода (28.10)', () => {
  it('сообщает, сколько заняла каждая попытка, и при успехе, и при отказе', async () => {
    let clock = 0;
    const slowFail: CoachProvider = {
      async createTurn() {
        clock += 40_000;
        throw new CoachProviderError('provider_unavailable', 503, true);
      },
    };
    const answer: CoachProvider = {
      async createTurn() {
        clock += 30_000;
        return result('openai');
      },
    };
    const seen: Array<{ provider: string; status: string; elapsedMs: number }> = [];
    const provider = new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', model: 'openrouter/free', provider: slowFail },
        { id: 'openai', model: 'gpt-5.6-luna', provider: answer },
      ],
      now: () => clock,
      onAttempts: (attempts) => seen.push(...attempts),
    });
    await provider.createTurn(input, '99999999-9999-4999-8999-999999999999');
    expect(seen).toEqual([
      expect.objectContaining({ provider: 'openrouter', status: 'failed', elapsedMs: 40_000 }),
      expect.objectContaining({ provider: 'openai', status: 'succeeded', elapsedMs: 30_000 }),
    ]);
  });
});

describe('дедлайн хода (28.10)', () => {
  it('не начинает ступень, когда до дедлайна хода осталось меньше минимума, и не ждёт дольше остатка', async () => {
    let clock = 0;
    const slow: CoachProvider = {
      createTurn: () => new Promise(() => {}),
    };
    const calls: string[] = [];
    const never: CoachProvider = {
      async createTurn() {
        calls.push('second');
        return result('nvidia');
      },
    };
    const provider = new ResilientCoachProvider({
      routes: [
        { id: 'openai', provider: slow },
        { id: 'nvidia', provider: never },
      ],
      now: () => clock,
    });
    const started = Date.now();
    clock = 0;
    const turn = provider.createTurn(input, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      deadlineAt: 50,
    });
    // The first route may wait only the 50 ms left; after it the deadline is gone.
    setTimeout(() => {
      clock = 100;
    }, 20);
    await expect(turn).rejects.toMatchObject({ code: 'provider_timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toEqual([]);
  });
});
