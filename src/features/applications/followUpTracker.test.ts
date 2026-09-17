import { describe, expect, it } from 'vitest';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import {
  calculateFollowUpStage,
  generateFollowUpMessage,
  findPendingFollowUps,
} from './followUpTracker';

describe('followUpTracker', () => {
  const BASE_NOW = new Date('2026-09-17T12:00:00.000Z');

  function makeDate(daysAgo: number): string {
    const d = new Date(BASE_NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }

  describe('calculateFollowUpStage', () => {
    it('возвращает "none" для нулевых или некорректных дат', () => {
      expect(calculateFollowUpStage(null, BASE_NOW)).toBe('none');
      expect(calculateFollowUpStage('', BASE_NOW)).toBe('none');
      expect(calculateFollowUpStage('invalid-date', BASE_NOW)).toBe('none');
    });

    it('возвращает "none" для откликов из будущего', () => {
      const future = new Date(BASE_NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
      expect(calculateFollowUpStage(future, BASE_NOW)).toBe('none');
    });

    it('возвращает "none" для откликов младше 5 дней (0-4 дня)', () => {
      expect(calculateFollowUpStage(makeDate(0), BASE_NOW)).toBe('none');
      expect(calculateFollowUpStage(makeDate(1), BASE_NOW)).toBe('none');
      expect(calculateFollowUpStage(makeDate(4), BASE_NOW)).toBe('none');
    });

    it('возвращает "day_5" для откликов на 5-7 день', () => {
      expect(calculateFollowUpStage(makeDate(5), BASE_NOW)).toBe('day_5');
      expect(calculateFollowUpStage(makeDate(6), BASE_NOW)).toBe('day_5');
      expect(calculateFollowUpStage(makeDate(7), BASE_NOW)).toBe('day_5');
    });

    it('возвращает "day_8" для откликов на 8-10 день', () => {
      expect(calculateFollowUpStage(makeDate(8), BASE_NOW)).toBe('day_8');
      expect(calculateFollowUpStage(makeDate(9), BASE_NOW)).toBe('day_8');
      expect(calculateFollowUpStage(makeDate(10), BASE_NOW)).toBe('day_8');
    });

    it('возвращает "stale" для откликов старше 10 дней', () => {
      expect(calculateFollowUpStage(makeDate(11), BASE_NOW)).toBe('stale');
      expect(calculateFollowUpStage(makeDate(30), BASE_NOW)).toBe('stale');
    });
  });

  describe('generateFollowUpMessage', () => {
    it('генерирует корректное первое повторное касание (5-й день)', () => {
      const msg = generateFollowUpMessage({
        vacancyTitle: 'Senior Frontend Engineer',
        companyName: 'Acme Corp',
        candidateName: 'Алексей',
        stage: 'day_5',
      });

      expect(msg).toContain('Senior Frontend Engineer');
      expect(msg).toContain('Acme Corp');
      expect(msg).toContain('Алексей');
      expect(msg).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
      expect(msg).not.toMatch(new RegExp(['д', 'о', 'с', 'ь', 'е'].join(''), 'i'));
    });

    it('генерирует финальное повторное касание (8-й день)', () => {
      const msg = generateFollowUpMessage({
        vacancyTitle: 'Product Manager',
        companyName: 'Tech Innovators',
        candidateName: 'Елена',
        stage: 'day_8',
      });

      expect(msg).toContain('Product Manager');
      expect(msg).toContain('Tech Innovators');
      expect(msg).toContain('Елена');
      expect(msg).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
      expect(msg).not.toMatch(new RegExp(['д', 'о', 'с', 'ь', 'е'].join(''), 'i'));
    });

    it('работает корректно без указания имени кандидата', () => {
      const msg = generateFollowUpMessage({
        vacancyTitle: 'QA Lead',
        companyName: 'FinCloud',
        stage: 'day_5',
      });

      expect(msg).toContain('QA Lead');
      expect(msg).toContain('FinCloud');
      expect(msg.length).toBeGreaterThan(50);
    });
  });

  describe('findPendingFollowUps', () => {
    it('находит только отклики в статусе applied, требующие касания (day_5 и day_8)', () => {
      const sampleApplications: VacancyApplication[] = [
        {
          clusterId: 'app-opened-5d',
          status: 'opened',
          vacancy: {
            title: 'DevOps Engineer',
            company: 'CloudCo',
            url: 'https://example.com/1',
            source: 'hh',
          },
          openedAt: makeDate(5),
          appliedAt: null,
          confirmedBy: null,
        },
        {
          clusterId: 'app-applied-2d',
          status: 'applied',
          vacancy: {
            title: 'Backend Lead',
            company: 'DataCorp',
            url: 'https://example.com/2',
            source: 'hh',
          },
          openedAt: makeDate(2),
          appliedAt: makeDate(2),
          confirmedBy: 'candidate',
        },
        {
          clusterId: 'app-applied-5d',
          status: 'applied',
          vacancy: {
            title: 'Frontend Developer',
            company: 'WebStudio',
            url: 'https://example.com/3',
            source: 'linkedin',
          },
          openedAt: makeDate(5),
          appliedAt: makeDate(5),
          confirmedBy: 'candidate',
        },
        {
          clusterId: 'app-applied-9d',
          status: 'applied',
          vacancy: {
            title: 'System Architect',
            company: 'ArchTech',
            url: 'https://example.com/4',
            source: 'hh',
          },
          openedAt: makeDate(9),
          appliedAt: makeDate(9),
          confirmedBy: 'candidate',
        },
        {
          clusterId: 'app-applied-20d',
          status: 'applied',
          vacancy: {
            title: 'Analyst',
            company: 'OldCorp',
            url: 'https://example.com/5',
            source: 'hh',
          },
          openedAt: makeDate(20),
          appliedAt: makeDate(20),
          confirmedBy: 'candidate',
        },
      ];

      const pending = findPendingFollowUps(sampleApplications, BASE_NOW);

      expect(pending).toHaveLength(2);
      expect(pending[0]?.application.clusterId).toBe('app-applied-5d');
      expect(pending[0]?.stage).toBe('day_5');
      expect(pending[0]?.daysSinceApplied).toBe(5);
      expect(pending[0]?.message).toContain('Frontend Developer');

      expect(pending[1]?.application.clusterId).toBe('app-applied-9d');
      expect(pending[1]?.stage).toBe('day_8');
      expect(pending[1]?.daysSinceApplied).toBe(9);
      expect(pending[1]?.message).toContain('System Architect');
    });
  });
});
