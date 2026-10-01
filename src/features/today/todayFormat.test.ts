import { describe, expect, it } from 'vitest';
import {
  buildReturningDigestItems,
  companyInitials,
  formatInterviewDate,
  formatQueueTitle,
  nextInterviewBasis,
} from './todayFormat';

describe('todayFormat (B255 returning user digest)', () => {
  it('formats interview date in Russian', () => {
    // 2026-10-15
    const formatted = formatInterviewDate('2026-10-15T14:00:00.000Z');
    expect(formatted).toBe('15 октября');
  });

  it('returns empty items when since is null (first visit)', () => {
    const items = buildReturningDigestItems({
      since: null,
      newVacanciesCount: 5,
      applicationsWaitingOver7Days: 2,
      nearestInterview: {
        company: 'Acme',
        title: 'CTO',
        round: 1,
        at: '2026-10-15T14:00:00.000Z',
      },
    });
    expect(items).toEqual([]);
  });

  it('returns empty items when nothing is new since last visit', () => {
    const items = buildReturningDigestItems({
      since: '2026-09-24T10:00:00.000Z',
      newVacanciesCount: 0,
      applicationsWaitingOver7Days: 0,
      nearestInterview: null,
    });
    expect(items).toEqual([]);
  });

  it('builds returning digest items with correct plural forms and target views', () => {
    const items = buildReturningDigestItems({
      since: '2026-09-24T10:00:00.000Z',
      newVacanciesCount: 3,
      applicationsWaitingOver7Days: 1,
      nearestInterview: {
        company: 'HRTx Inc.',
        title: 'Enterprise Architect',
        round: 2,
        at: '2026-10-02T10:00:00.000Z',
      },
    });

    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      id: 'vacancies',
      label: '3 новые подходящие вакансии',
      targetView: 'opportunities',
    });

    expect(items[1]).toEqual({
      id: 'applications',
      label: '1 отклик ждёт ответа больше 7 дней',
      targetView: 'responses',
    });

    expect(items[2]).toEqual({
      id: 'interview',
      label: 'ближайшее интервью 2 октября',
      targetView: 'responses',
    });
  });

  it('handles partial returning items (only vacancies or only applications)', () => {
    const onlyVacancies = buildReturningDigestItems({
      since: '2026-09-24T10:00:00.000Z',
      newVacanciesCount: 1,
      applicationsWaitingOver7Days: 0,
      nearestInterview: null,
    });
    expect(onlyVacancies).toEqual([
      {
        id: 'vacancies',
        label: '1 новая подходящая вакансия',
        targetView: 'opportunities',
      },
    ]);

    const onlyWaitingApps = buildReturningDigestItems({
      since: '2026-09-24T10:00:00.000Z',
      newVacanciesCount: 0,
      applicationsWaitingOver7Days: 5,
      nearestInterview: null,
    });
    expect(onlyWaitingApps).toEqual([
      {
        id: 'applications',
        label: '5 откликов ждут ответа больше 7 дней',
        targetView: 'responses',
      },
    ]);
  });

  it('keeps existing format helpers working', () => {
    expect(companyInitials('Google Cloud')).toBe('GC');
    expect(companyInitials(null)).toBe('—');
    expect(
      nextInterviewBasis({
        company: 'Acme',
        title: 'DevOps',
        round: 1,
        at: '2026-10-02T14:00:00.000Z',
      }),
    ).toContain('Acme · раунд 1');

    // B328: format with candidate's timezone
    const moscowTime = nextInterviewBasis(
      {
        company: 'Acme',
        title: 'DevOps',
        round: 1,
        at: '2026-10-02T14:00:00.000Z',
      },
      'Europe/Moscow',
    );
    expect(moscowTime).toContain('17:00');

    const newYorkTime = nextInterviewBasis(
      {
        company: 'Acme',
        title: 'DevOps',
        round: 1,
        at: '2026-10-02T14:00:00.000Z',
      },
      'America/New_York',
    );
    expect(newYorkTime).toContain('10:00');
  });

  describe('D10: сборка заголовка карточки очереди', () => {
    it('форматирует «Компания — Должность» для валидной компании', () => {
      expect(formatQueueTitle('Acme Corp', 'Head of Product')).toBe('Acme Corp — Head of Product');
    });

    it('подставляет «Компания не указана — Должность», если компании нет', () => {
      expect(formatQueueTitle(null, 'Head of Product')).toBe('Компания не указана — Head of Product');
      expect(formatQueueTitle('', 'Head of Product')).toBe('Компания не указана — Head of Product');
      expect(formatQueueTitle('   ', 'Head of Product')).toBe('Компания не указана — Head of Product');
    });

    it('не пропускает ФИО человека в заголовок, подставляя «Компания не указана»', () => {
      expect(formatQueueTitle('Глушкова Ксения Евгеньевна', 'Head of Engineering')).toBe(
        'Компания не указана — Head of Engineering',
      );
      expect(formatQueueTitle('Иванов Иван Иванович', 'CTO')).toBe('Компания не указана — CTO');
      expect(formatQueueTitle('Петрова Анна', 'VP of Engineering')).toBe(
        'Компания не указана — VP of Engineering',
      );
    });

    it('companyInitials возвращает «—» для ФИО человека', () => {
      expect(companyInitials('Глушкова Ксения Евгеньевна')).toBe('—');
    });
  });
});
