import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoachProvider, CoachTurnOptions } from './providers/coachProvider';
import { COACH_TURN_BUDGET_MS } from './providers/stageTimeout';
import { createApp, candidateAuthorization, successProvider } from './appTestHarness';

describe('дедлайн хода консультанта (28.10)', () => {
  it('укладывает ход в ожидание клиента с запасом', () => {
    const clientResultWaitMs = 240_000; // RESULT_WAIT_MS, src/features/coach/coachResultDelivery.ts
    expect(COACH_TURN_BUDGET_MS).toBeLessThanOrEqual(clientResultWaitMs - 10_000);
  });

  it('передаёт провайдеру момент, к которому ход должен быть готов', async () => {
    const seen: Array<CoachTurnOptions | undefined> = [];
    const provider: CoachProvider = {
      async createTurn(input, key, options) {
        seen.push(options);
        return successProvider.createTurn(input, key);
      },
    };
    const app = await createApp(provider);
    const before = Date.now();
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization: candidateAuthorization(app), 'idempotency-key': randomUUID() },
      payload: { messageId: randomUUID(), content: 'Что мне делать дальше?' },
    });
    const deadlineAt = seen[0]?.deadlineAt ?? 0;
    expect(deadlineAt).toBeGreaterThanOrEqual(before + COACH_TURN_BUDGET_MS);
    expect(deadlineAt).toBeLessThanOrEqual(Date.now() + COACH_TURN_BUDGET_MS);
  });
});
