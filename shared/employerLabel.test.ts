import { describe, expect, it } from 'vitest';
import {
  EMPLOYER_NOT_NAMED,
  employerLabel,
  isNamedEmployer,
  partitionEmployers,
} from './employerLabel';

describe('employerLabel', () => {
  it('returns the employer when the source named one', () => {
    expect(employerLabel('МТС Банк')).toBe('МТС Банк');
  });

  it('says the employer is not named instead of showing an empty gap', () => {
    expect(employerLabel('')).toBe(EMPLOYER_NOT_NAMED);
    expect(employerLabel('   ')).toBe(EMPLOYER_NOT_NAMED);
    expect(employerLabel(undefined)).toBe(EMPLOYER_NOT_NAMED);
  });

  describe('B375: isNamedEmployer', () => {
    it('отклоняет описания вместо названий компаний: примеры из пакета', () => {
      expect(isNamedEmployer('Enterprise Public Cloud Platform (IaaS / PaaS)')).toBe(false);
      expect(isNamedEmployer('Corporate University of a Top-Tier Financial Institution')).toBe(false);
    });

    it('отклоняет строки длиннее 60 символов', () => {
      const longName = 'A'.repeat(61);
      expect(isNamedEmployer(longName)).toBe(false);
    });

    it('отклоняет строки без заглавной буквы', () => {
      expect(isNamedEmployer('enterprise software engineering')).toBe(false);
      expect(isNamedEmployer('частная компания')).toBe(false);
    });

    it('принимает обычные названия компаний', () => {
      expect(isNamedEmployer('Яндекс')).toBe(true);
      expect(isNamedEmployer('Сбер')).toBe(true);
      expect(isNamedEmployer('Acme Corp')).toBe(true);
    });

    it('partitionEmployers разделяет валидные и неопределённые компании', () => {
      const input = [
        'Enterprise Public Cloud Platform (IaaS / PaaS)',
        'Яндекс',
        'Corporate University of a Top-Tier Financial Institution',
        'Acme Corp',
      ];
      const result = partitionEmployers(input);
      expect(result.validEmployers).toEqual(['Яндекс', 'Acme Corp']);
      expect(result.unidentifiedEmployers).toEqual([
        'Enterprise Public Cloud Platform (IaaS / PaaS)',
        'Corporate University of a Top-Tier Financial Institution',
      ]);
    });
  });
});

