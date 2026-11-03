import { describe, expect, it } from 'vitest';
import { searchTermsForRoles } from './vacancyDemandTerms';

describe('роли кандидатов → запросы к LinkedIn и Indeed (27.10)', () => {
  it('английское название идёт запросом как есть, без скобок и хвостов', () => {
    expect(searchTermsForRoles(['Head of AI', 'VP of Customer Support (B2B)'])).toEqual([
      'head of ai',
      'vp of customer support',
    ]);
  });

  it('русское название переводится через словарь ролей', () => {
    const terms = searchTermsForRoles(['Руководитель службы поддержки', 'Директор по IT (CIO)']);
    expect(terms).toContain('head of customer support');
    expect(terms.some((term) => term.includes('it') || term.includes('information'))).toBe(true);
  });

  it('составное название даёт запрос на каждую часть, кроме одиночного слова', () => {
    expect(searchTermsForRoles(['VP of Engineering / Technology'])).toEqual(['vp of engineering']);
  });

  it('роль из общего веера всё равно идёт запросом: роли спроса читаются раньше круга', () => {
    expect(searchTermsForRoles(['CTO', 'Chief of Staff'])).toEqual(['chief of staff']);
  });

  it('название, которого словарь не знает, не уходит запросом', () => {
    expect(searchTermsForRoles(['Совсем непонятная должность'])).toEqual([]);
  });

  it('русское название роли остаётся запросом для hh рядом с переводом', () => {
    const terms = searchTermsForRoles(['Главный бухгалтер', 'Руководитель направления AI']);
    expect(terms).toContain('главный бухгалтер');
    expect(terms).toContain('руководитель направления ai');
  });

  it('без повторов', () => {
    expect(searchTermsForRoles(['Head of AI', 'head of AI', 'Head of AI'])).toEqual(['head of ai']);
  });

  it('руководящая русская роль поддержки даёт несколько английских формулировок', () => {
    const terms = searchTermsForRoles(['Директор по клиентскому сервису и технической поддержке']);
    for (const expected of [
      'head of customer support',
      'customer support director',
      'director of customer service',
      'customer experience director',
    ]) {
      expect(terms).toContain(expected);
    }
    expect(terms.filter((term) => /^[a-z ]+$/u.test(term)).length).toBeLessThanOrEqual(6);
  });

  it('рядовая роль остаётся одним английским запросом', () => {
    const terms = searchTermsForRoles(['Специалист технической поддержки']);
    expect(terms.filter((term) => /^[a-z ]+$/u.test(term))).toHaveLength(1);
  });
});
