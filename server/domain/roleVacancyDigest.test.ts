import { describe, expect, it } from 'vitest';
import {
  digestCount,
  digestDay,
  mergeDigestMarks,
  ROLE_DIGEST_SOURCE_TYPE,
  roleDigestKey,
  roleDigestTitle,
  roleGenitiveRu,
} from './roleVacancyDigest';

describe('roleGenitiveRu', () => {
  it.each([
    ['Руководитель разработки', 'руководителя разработки'],
    ['Технический директор', 'технического директора'],
    ['Старший аналитик данных', 'старшего аналитика данных'],
    ['Вице-президент по разработке / технологиям', 'вице-президента по разработке / технологиям'],
    ['Операционный директор (COO)', 'операционного директора (COO)'],
    ['Главный бухгалтер', 'главного бухгалтера'],
    ['Продавец-консультант', null],
    ['Продавец', 'продавца'],
    ['Бизнес-аналитик', 'бизнес-аналитика'],
  ])('%s → %s', (role, expected) => {
    expect(roleGenitiveRu(role)).toBe(expected);
  });

  it('латиница и незнакомые окончания — без падежа', () => {
    expect(roleGenitiveRu('Engineering Manager')).toBeNull();
    expect(roleGenitiveRu('Няня')).toBeNull();
    expect(roleGenitiveRu('Продавец-консультант')).toBeNull();
    expect(roleGenitiveRu('')).toBeNull();
  });
});

describe('roleDigestTitle', () => {
  it('число по-русски, роль в родительном падеже', () => {
    expect(roleDigestTitle(6, ['Руководитель разработки'])).toBe(
      '6 новых вакансий руководителя разработки',
    );
    expect(roleDigestTitle(1, ['Руководитель разработки'])).toBe(
      '1 новая вакансия руководителя разработки',
    );
    expect(roleDigestTitle(3, ['Engineering Manager'])).toBe('3 новые вакансии по вашей роли');
    expect(roleDigestTitle(21, ['CTO', 'CIO'])).toBe('21 новая вакансия по вашим ролям');
  });
});

describe('подборка дня', () => {
  it('набор того же дня дописывается: число растёт, уже учтённые не считаются дважды', () => {
    const first = mergeDigestMarks('', ['a', 'b', 'c']);
    expect(digestCount(ROLE_DIGEST_SOURCE_TYPE, first)).toBe(3);
    const second = mergeDigestMarks(first, ['c', 'd']);
    expect(digestCount(ROLE_DIGEST_SOURCE_TYPE, second)).toBe(4);
    expect(mergeDigestMarks(second, ['a', 'd'])).toBe(second);
  });

  it('прежние записи по хэшу набора числа не несут', () => {
    expect(digestCount('matched_vacancy_batch', 'abc')).toBeNull();
    expect(digestCount(ROLE_DIGEST_SOURCE_TYPE, '')).toBeNull();
  });

  it('сутки по Москве, ключ — день и набор ролей без учёта порядка', () => {
    expect(digestDay(new Date('2026-11-23T20:59:00Z'))).toBe('2026-11-23');
    expect(digestDay(new Date('2026-11-23T21:01:00Z'))).toBe('2026-11-24');
    expect(roleDigestKey('2026-11-23', ['CTO', 'CIO'])).toBe(
      roleDigestKey('2026-11-23', ['cio', 'CTO']),
    );
    expect(roleDigestKey('2026-11-23', ['CTO'])).not.toBe(roleDigestKey('2026-11-24', ['CTO']));
  });
});
