import { describe, expect, it } from 'vitest';
import { tierOf } from '../../src/features/b640/account/billingModel';
import { TARIFF_BENEFITS, TARIFF_PLANS } from '../../src/features/tariffs/tariffTypes';
import { TARIFF_QUOTAS } from './tariffQuotas';
import {
  draftQuotaPlan,
  LINKEDIN_DRAFTS_PER_DAY,
  linkedinDraftsPerDay,
} from './linkedinDraftTariff';

/** Число перед словом в обещании страницы тарифов: «3 в день», «5 комментариев». */
function promised(text: string, word: RegExp): number {
  const match = new RegExp(`(\\d+)\\s+${word.source}`, 'u').exec(text);
  if (!match) throw new Error(`no number before ${word.source} in «${text}»`);
  return Number(match[1]);
}

describe('B778: черновики LinkedIn — как обещает страница тарифов', () => {
  it('Pro: комментарии из «Черновики комментариев — N в день», посты — месячные из t01 / 30', () => {
    const benefit = TARIFF_BENEFITS.find((item) => item.id === 'comment_drafts')!;
    expect(benefit.includedIn).toEqual(['pro']);
    // t01 (billingModel.ts): «Посты LinkedIn 90» в месяц — та же квота linkedin_drafts.
    const monthlyPosts = Number(tierOf('pro').posts);
    expect(TARIFF_QUOTAS.pro.linkedin_drafts).toBe(monthlyPosts);
    expect(LINKEDIN_DRAFTS_PER_DAY.pro).toEqual({
      comment: promised(benefit.title, /в день/u),
      post: monthlyPosts / 30,
    });
    expect(linkedinDraftsPerDay('pro', 'post')).toBe(3);
  });

  it('Executive/Max: «До N комментариев и M постов в день» — два отдельных счётчика', () => {
    const summary = TARIFF_PLANS.executive.summary;
    expect(LINKEDIN_DRAFTS_PER_DAY.max).toEqual({
      comment: promised(summary, /комментари/u),
      post: promised(summary, /пост/u),
    });
    expect(linkedinDraftsPerDay('executive', 'post')).toBe(LINKEDIN_DRAFTS_PER_DAY.max.post);
    expect(TARIFF_QUOTAS.max.linkedin_drafts).toBe(Number(tierOf('max').posts));
  });

  it('Free/Basic — ничего; день есть только там, где есть месячная квота', () => {
    for (const plan of ['free', 'basic', 'pro', 'max'] as const) {
      const perDay = LINKEDIN_DRAFTS_PER_DAY[plan];
      if (TARIFF_QUOTAS[plan].linkedin_drafts === 0) {
        expect(perDay).toEqual({ comment: 0, post: 0 });
        expect(tierOf(plan).posts).toBeNull();
      }
      else expect(perDay.comment + perDay.post).toBeGreaterThan(0);
    }
  });

  it('старые названия — Max, неизвестное и служебные ключи — Free', () => {
    expect(draftQuotaPlan('executive')).toBe('max');
    expect(draftQuotaPlan('enterprise')).toBe('max');
    expect(draftQuotaPlan('unexpected')).toBe('free');
    expect(draftQuotaPlan('__proto__')).toBe('free');
    expect(linkedinDraftsPerDay('constructor', 'comment')).toBe(0);
  });
});
