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

describe('generatedTextFactNotices: one notice in the language of the letter', () => {
  const claims = Array.from({ length: 14 }, (_, i) => `I led team ${i + 1}.`);

  it('an English letter gets an English notice, one line for all unconfirmed claims', () => {
    const notices = generatedTextFactNotices('en', [check(claims), check(claims.slice(0, 3))]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toMatch(/Can you confirm|\?/u);
    expect(notices[0]).toMatch(/^Before sending, check 14 claims against your profile/u);
    expect(notices[0]).toContain('"I led team 1."');
    expect(notices[0]).toContain('and 11 more');
    expect(notices[0]).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it('a Russian letter keeps its Russian notice', () => {
    const [notice] = generatedTextFactNotices('ru', [check(claims)]);
    expect(notice).toMatch(/^Перед отправкой сверьте с профилем 14 утверждений/u);
    expect(notice).toContain('и ещё 11');
  });

  it('nothing unconfirmed — no notices', () => {
    expect(generatedTextFactNotices('ru', [])).toEqual([]);
  });
});
