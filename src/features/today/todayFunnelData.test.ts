import { describe, expect, it } from 'vitest';
import { todayFunnelStages } from './todayFunnelData';

describe('todayFunnelStages', () => {
  it('takes every application stage from the one server cohort, never mixing in momentum', () => {
    const stages = todayFunnelStages(
      {
        momentum: undefined,
        funnel: { favorites: 1, applied: 6, responses: 4, interviews: 2, offers: 1 },
      },
      { found: 214 },
    );
    expect(stages.map((stage) => stage.value)).toEqual([214, 1, 6, 4, 2, 1]);
  });

  it('reads applied and interviews as unknown when an old server sends neither nor momentum', () => {
    const stages = todayFunnelStages({
      momentum: undefined,
      funnel: { favorites: 0, responses: 0, offers: 0 },
    });
    expect(stages.find((stage) => stage.key === 'applied')?.value).toBe('unknown');
  });
});
