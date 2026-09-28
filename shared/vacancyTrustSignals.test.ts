import { describe, expect, it } from 'vitest';
import {
  vacancyTrustSignals,
  type VacancyTrustInput,
} from './vacancyTrustSignals';

describe('vacancyTrustSignals', () => {
  const baseNow = '2026-09-28T12:00:00.000Z';

  const cleanVacancy: VacancyTrustInput = {
    canonicalTitle: 'VP of Engineering',
    canonicalCompany: 'Tech Corp',
    canonicalLocation: 'Dubai',
    descriptionSummary: 'Lead engineering teams across 3 distributed hubs.',
    primaryUrl: 'https://hh.ru/vacancy/123456',
    firstObservedAt: '2026-09-20T12:00:00.000Z',
    vacanciesCount: 1,
    status: 'active',
  };

  it('marks a fresh, clean vacancy as ok with no reasons', () => {
    const signals = vacancyTrustSignals(cleanVacancy, baseNow);
    expect(signals.level).toBe('ok');
    expect(signals.reasons).toEqual([]);
    expect(signals.isStale).toBe(false);
    expect(signals.isSuspicious).toBe(false);
  });

  describe('dead links (B200)', () => {
    it('detects deadLink flag and flags as suspicious', () => {
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, deadLink: true },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.deadLink).toBe(true);
      expect(signals.isSuspicious).toBe(true);
      expect(signals.reasons).toContain('Ссылка на вакансию недоступна');
    });

    it('detects linkStatus "gone" as dead link', () => {
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, linkStatus: 'gone' },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.deadLink).toBe(true);
      expect(signals.reasons).toContain('Ссылка на вакансию недоступна');
    });

    it('detects archived status as dead link', () => {
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, status: 'archived' },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.deadLink).toBe(true);
      expect(signals.reasons).toContain('Ссылка на вакансию недоступна');
    });
  });

  describe('stale and phantom listings', () => {
    it('flags vacancy open for >= 60 days as stale', () => {
      // 65 days before baseNow
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, firstObservedAt: '2026-07-25T12:00:00.000Z' },
        baseNow,
      );
      expect(signals.level).toBe('stale');
      expect(signals.isStale).toBe(true);
      expect(signals.reasons[0]).toMatch(/Вакансия открыта более 60 дней \(65 дн\.\)/);
    });

    it('does not flag vacancy open for 59 days as stale', () => {
      // 59 days before baseNow (2026-07-31)
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, firstObservedAt: '2026-07-31T12:00:00.000Z' },
        baseNow,
      );
      expect(signals.level).toBe('ok');
      expect(signals.isStale).toBe(false);
    });

    it('flags vacancy with >= 3 reposts as phantom/stale', () => {
      const signals = vacancyTrustSignals(
        { ...cleanVacancy, vacanciesCount: 4 },
        baseNow,
      );
      expect(signals.level).toBe('stale');
      expect(signals.isStale).toBe(true);
      expect(signals.reasons[0]).toMatch(/Многократные перепубликации \(4 раза/);
    });

    it('combines age and reposts if both apply', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          firstObservedAt: '2026-07-01T12:00:00.000Z',
          vacanciesCount: 3,
        },
        baseNow,
      );
      expect(signals.level).toBe('stale');
      expect(signals.reasons.length).toBe(2);
    });
  });

  describe('suspicious / scam patterns', () => {
    it('flags money transfers / mule keywords in description', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          descriptionSummary: 'Требуется перевод денег через личный счёт, быстрый обнал',
        },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.isSuspicious).toBe(true);
      expect(signals.reasons).toContain('Признаки сомнительных финансовых условий в описании');
    });

    it('flags advance fee or deposit requirements', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          descriptionSummary: 'Для начала работы требуется страховой взнос за оборудование',
        },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.isSuspicious).toBe(true);
      expect(signals.reasons).toContain('Признаки сомнительных финансовых условий в описании');
    });

    it('flags unrealistic easy money promises in title', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          canonicalTitle: 'Лёгкий заработок от 5000$ в день без опыта',
        },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.isSuspicious).toBe(true);
      expect(signals.reasons).toContain('Признаки сомнительных финансовых условий в описании');
    });

    it('flags suspicious / shady domain TLDs and shorteners', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          primaryUrl: 'https://super-jobs-hiring.xyz/apply',
        },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.isSuspicious).toBe(true);
      expect(signals.reasons).toContain('Подозрительный домен публикации вакансии');
    });

    it('allows reputable aggregators without domain mismatch flag', () => {
      const aggregators = [
        'https://hh.ru/vacancy/112233',
        'https://headhunter.ru/vacancy/44',
        'https://remotive.com/jobs/dev-1',
        'https://www.linkedin.com/jobs/view/100',
        'https://career.habr.com/vacancies/555',
      ];
      for (const url of aggregators) {
        const signals = vacancyTrustSignals({ ...cleanVacancy, primaryUrl: url }, baseNow);
        expect(signals.level).toBe('ok');
        expect(signals.reasons).toEqual([]);
      }
    });
  });

  describe('priority of signals', () => {
    it('suspicious takes priority over stale', () => {
      const signals = vacancyTrustSignals(
        {
          ...cleanVacancy,
          firstObservedAt: '2026-06-01T12:00:00.000Z', // > 60 days
          vacanciesCount: 5, // > 3 reposts
          deadLink: true, // suspicious
        },
        baseNow,
      );
      expect(signals.level).toBe('suspicious');
      expect(signals.isSuspicious).toBe(true);
      expect(signals.isStale).toBe(true);
      expect(signals.deadLink).toBe(true);
      // Dead link reason should come first
      expect(signals.reasons[0]).toBe('Ссылка на вакансию недоступна');
    });
  });
});
