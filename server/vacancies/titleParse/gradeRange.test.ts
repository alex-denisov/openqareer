import { describe, expect, it } from 'vitest';
import { candidateGradeRange, gradeRangeOfTitle } from './gradeRange';

const overlap = (a: string, b: string) => {
  const left = gradeRangeOfTitle(a);
  const right = gradeRangeOfTitle(b);
  return left !== null && right !== null && left.min <= right.max && right.min <= left.max;
};

describe('gradeRangeOfTitle', () => {
  it('различает Junior и Senior там, где название это говорит', () => {
    expect(overlap('Senior Frontend Developer', 'Junior Frontend Engineer')).toBe(false);
    expect(overlap('Главный бухгалтер', 'Младший бухгалтер')).toBe(false);
    expect(overlap('Старшая медицинская сестра', 'Младшая медицинская сестра')).toBe(false);
  });

  it('соседние грейды пересекаются', () => {
    expect(overlap('Senior Frontend Developer', 'Middle Frontend Developer')).toBe(true);
    expect(overlap('Senior Frontend Developer', 'Lead Frontend Developer')).toBe(true);
    expect(overlap('Главный бухгалтер', 'Старший бухгалтер')).toBe(true);
  });

  it('два слова дают общий диапазон', () => {
    expect(gradeRangeOfTitle('Middle/Senior Developer')).toEqual({ min: 1, max: 5 });
  });

  it.each(['Frontend Developer', 'Бухгалтер', 'Lead generation specialist', 'Internal auditor', 'Seniority analyst', 'Middle East Sales Manager', 'Middle Office Analyst'])(
    'без слова грейда диапазона нет: %s',
    (title) => {
      expect(gradeRangeOfTitle(title)).toBeNull();
    },
  );
});

describe('candidateGradeRange', () => {
  it('слово в целевой роли важнее мест работы', () => {
    expect(
      candidateGradeRange({ targetRoles: ['Senior Frontend Developer'], recentTitles: ['Junior Developer'] }),
    ).toEqual({ min: 3, max: 5 });
  });

  it('без слова в ролях берёт последние места', () => {
    expect(
      candidateGradeRange({ targetRoles: ['Frontend Developer'], recentTitles: ['Senior Developer', 'Middle Developer'] }),
    ).toEqual({ min: 1, max: 5 });
  });

  it('старая роль не размывает окно', () => {
    expect(
      candidateGradeRange({
        targetRoles: ['Frontend Developer'],
        recentTitles: ['Senior Developer', 'Senior Developer', 'Junior Developer'],
      }),
    ).toEqual({ min: 3, max: 5 });
  });

  it('без слова нигде подбор не сужается', () => {
    expect(candidateGradeRange({ targetRoles: ['Frontend Developer'], recentTitles: ['Developer'] })).toBeNull();
  });
});
