import { describe, expect, it } from 'vitest';
import {
  buildReturningDigestItems,
  companyInitials,
  formatInterviewDate,
  formatQueueTitle,
  nextInterviewBasis,
  queueDiscussionContext,
  queueActionTitle,
  queueCompanyLabel,
  queueMobileSubtitle,
  queueMobileTitle,
  dativeNameRu,
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
      expect(formatQueueTitle(null, 'Head of Product')).toBe(
        'Компания не указана — Head of Product',
      );
      expect(formatQueueTitle('', 'Head of Product')).toBe('Компания не указана — Head of Product');
      expect(formatQueueTitle('   ', 'Head of Product')).toBe(
        'Компания не указана — Head of Product',
      );
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

describe('queueActionTitle', () => {
  it('writes the row as an action, as in the approved Today mockup', () => {
    const base = { company: 'Вектор Банк', title: 'Head of Platform' } as const;
    expect(queueActionTitle({ ...base, kind: 'follow_up' })).toBe(
      'Напомнить компании Вектор Банк про ответ',
    );
    expect(queueActionTitle({ ...base, kind: 'interview' })).toBe('Подготовиться к интервью');
    expect(queueActionTitle({ ...base, kind: 'candidate_turn' })).toBe('Ваш ход: Head of Platform');
  });

  it('builds discussion context only from the selected queue item fields', () => {
    const context = queueDiscussionContext({
      kind: 'follow_up',
      applicationId: 'app-123',
      title: 'Head of Platform',
      company: 'Вектор Банк',
      eyebrow: 'Ответа нет 6 дней',
      dueAt: '2026-10-17T09:00:00.000Z',
      fit: null,
    });

    expect(context).toContain('Напомнить компании Вектор Банк');
    expect(context).toContain('Head of Platform');
    expect(context).toContain('Ответа нет 6 дней');
    expect(context).toContain('app-123');
  });

  it('never uses a recruiter name as the company', () => {
    expect(
      queueActionTitle({ kind: 'follow_up', company: 'Глушкова Ксения Евгеньевна', title: 'X' }),
    ).toBe('Напомнить компании про ответ');
    expect(queueCompanyLabel('Глушкова Ксения Евгеньевна')).toBe('Компания не указана');
  });
});

describe('B542: reminder names the person, as in mockup 1', () => {
  const base = {
    kind: 'follow_up' as const,
    company: 'Вектор Банк',
    title: 'Head of Engineering',
    eyebrow: 'ответа нет 6 дней',
    dueAt: null,
    fit: null,
  };

  it('names the contact in the dative case and the topic after an interview', () => {
    expect(queueActionTitle({ ...base, contactName: 'Мария Орлова', afterInterview: true })).toBe(
      'Напомнить Марии Орловой про итог интервью',
    );
    expect(queueActionTitle({ ...base, contactName: 'Иван Петров' })).toBe(
      'Напомнить Ивану Петрову про ответ',
    );
  });

  it('falls back to the company and the reply when there is no contact', () => {
    expect(queueActionTitle(base)).toBe('Напомнить компании Вектор Банк про ответ');
  });

  it('keeps the 390 title short: the person only, the caption carries the company', () => {
    expect(queueMobileTitle({ ...base, contactName: 'Мария Орлова', afterInterview: true })).toBe(
      'Напомнить Марии Орловой',
    );
    expect(queueMobileTitle(base)).toBe('Напомнить про ответ');
    expect(queueMobileSubtitle({ ...base, contactName: 'Мария Орлова' }, false)).toBe(
      'Вектор Банк · ответа нет 6 дней',
    );
  });

  it('declines common Russian names into the dative case', () => {
    expect(dativeNameRu('Мария Орлова')).toBe('Марии Орловой');
    expect(dativeNameRu('Анна Смирнова')).toBe('Анне Смирновой');
    expect(dativeNameRu('Алексей Ковальский')).toBe('Алексею Ковальскому');
    expect(dativeNameRu('Ольга Белая')).toBe('Ольге Белой');
    expect(dativeNameRu('John Smith')).toBe('John Smith');
  });
});
