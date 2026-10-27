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

  it('роль, которую уже читает общий веер, не повторяется', () => {
    expect(searchTermsForRoles(['CTO', 'Chief of Staff'])).toEqual([]);
  });

  it('название, которое словарь не перевёл, не уходит запросом по-русски', () => {
    expect(searchTermsForRoles(['Совсем непонятная должность'])).toEqual([]);
  });

  it('без повторов', () => {
    expect(searchTermsForRoles(['Head of AI', 'head of AI', 'Head of AI'])).toEqual(['head of ai']);
  });
});
