import { describe, expect, it } from 'vitest';
import { catalogSourceView } from './catalogSources';

describe('catalogSourceView', () => {
  it('names ATS, Telegram and plain sources from the pool id', () => {
    expect(catalogSourceView('ats-greenhouse-stripe', 202)).toEqual({
      sourceId: 'ats-greenhouse-stripe',
      name: 'Stripe · Greenhouse',
      category: 'ATS компаний',
      count: 202,
    });
    expect(catalogSourceView('ats-smartrecruiters-BoschGroup', 1).name).toBe(
      'BoschGroup · SmartRecruiters',
    );
    expect(catalogSourceView('src-tg-react', 18)).toMatchObject({
      name: 'Telegram: react',
      category: 'Telegram каналы',
    });
    expect(catalogSourceView('src-amazon-jobs', 3).name).toBe('Amazon Jobs');
    expect(catalogSourceView('remotive', 3).name).toBe('Remotive');
  });
});
