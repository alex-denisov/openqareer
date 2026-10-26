import { describe, expect, it } from 'vitest';
import { generatedTextFactNotices, type GeneratedTextFactCheck } from './generatedTextFactGate';

const check = (texts: string[]): GeneratedTextFactCheck => ({
  scope: 'quantities_and_explicit_achievements',
  status: 'needs_confirmation',
  claims: texts.map((text) => ({
    text,
    status: 'not_in_profile',
    evidenceIds: [],
    action: 'ask_candidate',
  })),
});

describe('generatedTextFactNotices: one notice in the candidate language', () => {
  const claims = Array.from({ length: 14 }, (_, i) => `I led team ${i + 1}.`);

  it('an English letter still gets Russian notices, one line for all unconfirmed claims', () => {
    const notices = generatedTextFactNotices('en', [check(claims), check(claims.slice(0, 3))]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toMatch(/Can you confirm|\?/u);
    expect(notices[0]).toMatch(/^Перед отправкой сверьте с профилем 14 утверждений/u);
    expect(notices[0]).toContain('«I led team 1.»');
    expect(notices[0]).toContain('и ещё 11');
  });

  it('the model fallback notice is Russian too', () => {
    const notices = generatedTextFactNotices('en', [], check(['x']));
    expect(notices).toEqual([expect.stringMatching(/^В сгенерированном письме/u)]);
  });

  it('nothing unconfirmed — no notices', () => {
    expect(generatedTextFactNotices('ru', [])).toEqual([]);
  });
});
