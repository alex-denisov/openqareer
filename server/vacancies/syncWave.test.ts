import { describe, expect, it } from 'vitest';
import { companyLanePerHost, pickCompanyLane, pickWave, type ChannelTier } from './syncWave';

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

describe('B628 — company lane', () => {
  const item = (id: string, host: string) => ({ id, host });
  it('takes up to the limit with at most perHost sources per host, keeping order', () => {
    const sorted = [
      item('g1', 'gh'),
      item('g2', 'gh'),
      item('g3', 'gh'),
      item('a1', 'acme.io'),
      item('g4', 'gh'),
      item('b1', 'beta.io'),
    ];
    const picked = pickCompanyLane(sorted, 4, 2, (s) => s.host).map((s) => s.id);
    expect(picked).toEqual(['g1', 'g2', 'a1', 'b1']);
  });
  it('returns [] for a zero limit', () => {
    expect(pickCompanyLane([item('x', 'h')], 0, 3, (s) => s.host)).toEqual([]);
  });
});

describe('companyLanePerHost (B628 throughput)', () => {
  it('a public ATS API is limited per service, not like a corporate site', () => {
    expect(companyLanePerHost('boards-api.greenhouse.io')).toBe(16);
    expect(companyLanePerHost('api.lever.co')).toBe(16);
    expect(companyLanePerHost('api.ashbyhq.com')).toBe(16);
    expect(companyLanePerHost('www.example.com')).toBe(3);
  });
  it('pickCompanyLane accepts a per-host limit function', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, host: 'boards-api.greenhouse.io' }));
    expect(pickCompanyLane(sorted, 96, companyLanePerHost, (s) => s.host)).toHaveLength(16);
  });
});
