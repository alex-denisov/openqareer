import { describe, expect, it } from 'vitest';
import { todayFunnelHint, todayFunnelStages } from './todayFunnelData';

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

describe('B542: funnel hint, word for word from mockup 1', () => {
  const calculatedAt = new Date(2026, 9, 7, 9, 12).toISOString();
  const snapshot = (applied: number) => ({
    momentum: undefined,
    funnel: { favorites: 18, applied, responses: 2, interviews: 1, offers: 0 },
  });

  it('names the data date, the catalog and the small sample', () => {
    const stages = todayFunnelStages(snapshot(7), { found: 214 });
    expect(todayFunnelHint(stages, calculatedAt)).toBe(
      'Ваши данные на 07.10 09:12; «найдено» — каталог openqareer на ту же дату. Откликов меньше 10: на выводы о конверсии это не годится.',
    );
  });

  it('drops the sample warning once there are enough applications', () => {
    const stages = todayFunnelStages(snapshot(12), { found: 214 });
    expect(todayFunnelHint(stages, calculatedAt)).toBe(
      'Ваши данные на 07.10 09:12; «найдено» — каталог openqareer на ту же дату.',
    );
  });
});
