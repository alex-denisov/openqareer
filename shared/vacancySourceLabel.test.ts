import { describe, expect, it } from 'vitest';
import { vacancySourceLabel, vacancySourceLabels } from './vacancySourceLabel';

/** PRB-017: под вакансией стояли «json_api» и «rss, rss». */
describe('vacancySourceLabel', () => {
  it('names the platform the record came from', () => {
    expect(vacancySourceLabel({ sourceType: 'json_api', sourceName: 'Jobicy' })).toBe('Jobicy');
  });

  it('never shows the adapter type to the candidate', () => {
    expect(vacancySourceLabel({ sourceType: 'json_api' })).toBe('Открытый API');
    expect(vacancySourceLabel({ sourceType: 'rss' })).toBe('RSS-лента');
  });

  it('collapses a source repeated by every record of one cluster', () => {
    expect(
      vacancySourceLabels([
        { sourceType: 'rss', sourceName: 'Himalayas' },
        { sourceType: 'rss', sourceName: 'Himalayas' },
      ]),
    ).toEqual(['Himalayas']);
  });
});
