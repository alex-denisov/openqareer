import { describe, expect, it } from 'vitest';
import { pickWave, type ChannelTier } from './syncWave';

const items = (tier: ChannelTier, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${tier}-${i}`, tier }));

describe('pickWave (B622)', () => {
  it('aggregators get their seats even behind hundreds of company channels', () => {
    const wave = pickWave([...items(1, 300), ...items(3, 5)], 12, (x) => x.tier);
    expect(wave).toHaveLength(12);
    expect(wave.filter((x) => x.tier === 3)).toHaveLength(3);
    expect(wave.filter((x) => x.tier === 1)).toHaveLength(9);
  });

  it('unused seats go to whoever is due, in order', () => {
    const wave = pickWave([...items(1, 2), ...items(3, 20)], 12, (x) => x.tier);
    expect(wave.filter((x) => x.tier === 1)).toHaveLength(2);
    expect(wave.filter((x) => x.tier === 3)).toHaveLength(10);
  });
});
