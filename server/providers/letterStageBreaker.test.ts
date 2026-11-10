import { describe, expect, it } from 'vitest';
import { BREAKER_OPEN_MS, SlowStageBreaker, type BreakerEvent } from './letterStageBreaker';

const DS = 'openrouter:deepseek/deepseek-v4.1-flash';
const LABELS = [DS, 'openrouter:z-ai/glm-5.3-flash', 'vertex'];
const timeout = { stage: DS, kind: 'timeout' as const };

function breaker() {
  let now = 1_000_000;
  const events: BreakerEvent[] = [];
  const unit = new SlowStageBreaker(DS, () => now, (event) => events.push(event));
  return { unit, events, advance: (ms: number) => (now += ms) };
}

describe('SlowStageBreaker (B640): два таймаута DeepSeek за 10 минут — 10 минут с GLM', () => {
  it('один таймаут порядок не меняет', () => {
    const { unit } = breaker();
    unit.recordFailure(timeout);
    expect(unit.order(LABELS)).toEqual([0, 1, 2]);
  });

  it('второй таймаут в окне ставит GLM первой и пишет в журнал', () => {
    const { unit, events, advance } = breaker();
    unit.recordFailure(timeout);
    advance(5 * 60_000);
    unit.recordFailure(timeout);
    expect(unit.order(LABELS)).toEqual([1, 0, 2]);
    expect(events).toEqual([expect.objectContaining({ state: 'open', stage: DS, timeouts: 2 })]);
  });

  it('таймауты дальше 10 минут друг от друга автомат не включают', () => {
    const { unit, advance } = breaker();
    unit.recordFailure(timeout);
    advance(11 * 60_000);
    unit.recordFailure(timeout);
    expect(unit.order(LABELS)).toEqual([0, 1, 2]);
  });

  it('через 10 минут DeepSeek снова первая, возврат в журнале', () => {
    const { unit, events, advance } = breaker();
    unit.recordFailure(timeout);
    unit.recordFailure(timeout);
    advance(BREAKER_OPEN_MS);
    expect(unit.order(LABELS)).toEqual([0, 1, 2]);
    expect(events.map((event) => event.state)).toEqual(['open', 'closed']);
    unit.recordFailure(timeout);
    expect(unit.order(LABELS)).toEqual([0, 1, 2]);
  });

  it('отказ проверки и таймаут другой ступени не считаются', () => {
    const { unit } = breaker();
    unit.recordFailure({ stage: DS, kind: 'unusable_response', detail: 'letter_gate:name' });
    unit.recordFailure({ stage: LABELS[1]!, kind: 'timeout' });
    unit.recordFailure(timeout);
    expect(unit.order(LABELS)).toEqual([0, 1, 2]);
  });
});
