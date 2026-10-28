import { describe, expect, it } from 'vitest';
import { regionGate } from './vacancyFitContext';

describe('region gate of the fit (prod 28.10, QA_CANDIDATE)', () => {
  it('an explicit empty region list is no limit: unconfirmed, never blocked', () => {
    expect(regionGate('ru', { value: [], origin: 'explicit' }).status).toBe('unknown');
  });
  it('a chosen region list still matches or blocks', () => {
    expect(regionGate('ru', { value: ['ru'], origin: 'explicit' }).status).toBe('matched');
    expect(regionGate('us', { value: ['ru'], origin: 'explicit' }).status).toBe('blocked');
  });
  it('an unknown vacancy region or a default campaign is unconfirmed', () => {
    expect(regionGate(undefined, { value: ['ru'], origin: 'explicit' }).status).toBe('unknown');
    expect(regionGate('ru', { value: ['ru'], origin: 'default' }).status).toBe('unknown');
  });
});
