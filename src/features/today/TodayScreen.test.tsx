import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { consultantTargetView, queueItemTarget, TodayScreen } from './TodayScreen';
import { clearConsultantActionResolution, resolveConsultantAction } from './consultantActionStorage';
import type { TodaySnapshot } from './todayApi';

const snapshot: TodaySnapshot = {
  digest: {
    waitingForYou: 2,
    newVacancies: 3,
    followUpsDueToday: 1,
    followUpsOverdue: 1,
    closedVacancies: 1,
    interviewsAhead: 1,
    nextInterview: {
      company: 'HRTx Inc.',
      title: 'Enterprise Architect Director',
      round: 2,
      at: '2026-09-26T14:00:00.000Z',
    },
    newVacanciesCaption: {
      campaignRole: 'VP Technology Ops',
      sourcesCount: 3,
      updatedAt: '2026-09-24T09:14:00.000Z',
    },
    followUpCaptions: ['Peraton — 6 дней тишины'],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-1',
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      eyebrow: 'Follow-up · 6 дней без ответа',
      dueAt: null,
      salary: { from: 176000, currency: 'usd' },
      fit: null,
    },
    {
      kind: 'new_vacancy',
      clusterId: 'cl-1',
      title: 'Business Information Architect',
      company: 'Genetec',
      eyebrow: 'Новая вакансия · сегодня',
      dueAt: null,
      salary: { from: 190000, to: 240000, currency: 'usd' },
      location: 'Canada · удалённо',
      fit: { role: 'target', level: 'match', geo: true },
    },
  ],
  followUps: [
    { applicationId: 'app-1', company: 'Peraton', title: 'Enterprise Architect', status: 'today' },
    { applicationId: 'app-2', company: 'Genetec', title: 'Enterprise Architect', status: 'overdue' },
  ],
  sinceLastVisit: {
    since: '2026-09-23T09:00:00.000Z',
    items: ['Genetec запросили доступность на этой неделе'],
  },
  vacanciesPending: false,
};

function renderTodayScreen(props: Partial<Parameters<typeof TodayScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayScreen
      snapshot={snapshot}
      loading={false}
      failed={false}
      onRetry={vi.fn()}
      onMarkFollowUpSent={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

describe('TodayScreen (B251 S5)', () => {
  it('shows the digest counters with a basis caption under each number', () => {
    const html = renderTodayScreen();

    expect(html).toContain('3</span>');
    expect(html).toContain('напоминание компании на сегодня');
    expect(html).toContain('напоминание просрочено');
    expect(html).not.toContain('follow-up');
    expect(html).not.toContain('Follow-up');
    expect(html.match(/class="career-today-digest-number"/gu)).toHaveLength(4);
    expect(html).toContain('class="career-today-digest-number">1</span>');
    expect(html).toContain('кампания VP Technology Ops');
    expect(html).toContain('Peraton — 6 дней тишины');
    expect(html).toContain('HRTx Inc. · раунд 2');

    const htmlMultiple = renderTodayScreen({
      snapshot: {
        ...snapshot,
        digest: {
          ...snapshot.digest,
          followUpsDueToday: 5,
          followUpsOverdue: 5,
        },
      },
    });
    expect(htmlMultiple).toContain('напоминаний компании на сегодня');
    expect(htmlMultiple).toContain('напоминаний просрочено');
  });

  it('marks the first queue row with an accent border, not an overlapping flag', () => {
    const html = renderTodayScreen();

    expect(html).toContain('career-today-item is-first');
    expect(html).not.toContain('Следующее действие');
  });

  it('shows fit checks for a new vacancy and the action buttons per kind', () => {
    const html = renderTodayScreen();

    expect(html).toContain('роль');
    expect(html).toContain('Отметить отправленным');
    expect(html).toContain('Открыть');
  });

  it('uses one in-progress set for the queue action and follow-up list action', () => {
    const html = renderTodayScreen({ markingFollowUpIds: new Set(['app-1']) });

    expect(html.match(/Сохраняем…/gu)).toHaveLength(2);
    expect(html.match(/disabled="" aria-busy="true"/gu)).toHaveLength(2);
  });

  it('renders follow-ups by due date', () => {
    const html = renderTodayScreen();

    expect(html).toContain('Напоминания компании по срокам');
    expect(html).toContain('Peraton — Enterprise Architect');
    expect(html).toContain('сегодня');
  });

  it('shows returning-user line at the top with clickable links when returning (B255)', () => {
    const htmlWithReturning = renderTodayScreen({
      snapshot: {
        ...snapshot,
        digest: {
          ...snapshot.digest,
          applicationsWaitingOver7Days: 2,
        },
        sinceLastVisit: {
          since: '2026-09-23T09:00:00.000Z',
          items: ['Genetec запросили доступность на этой неделе'],
          newVacanciesCount: 3,
          applicationsWaitingOver7Days: 2,
          nearestInterview: {
            company: 'HRTx Inc.',
            title: 'Enterprise Architect Director',
            round: 2,
            at: '2026-09-26T14:00:00.000Z',
          },
        },
      },
    });

    expect(htmlWithReturning).toContain('career-today-return-banner');
    expect(htmlWithReturning).toContain('С прошлого визита:');
    expect(htmlWithReturning).toContain('3 новые подходящие вакансии');
    expect(htmlWithReturning).toContain('2 отклика ждут ответа больше 7 дней');
    expect(htmlWithReturning).toContain('ближайшее интервью 26 сентября');
    expect(htmlWithReturning).toContain('data-testid="since-visit-vacancies"');
    expect(htmlWithReturning).toContain('data-testid="since-visit-applications"');
    expect(htmlWithReturning).toContain('data-testid="since-visit-interview"');
  });

  it('does not show the returning banner when since is null or nothing is new (B255)', () => {
    const htmlFirstVisit = renderTodayScreen({
      snapshot: {
        ...snapshot,
        sinceLastVisit: { since: null, items: [] },
      },
    });
    expect(htmlFirstVisit).not.toContain('career-today-return-banner');

    const htmlNothingNew = renderTodayScreen({
      snapshot: {
        ...snapshot,
        digest: {
          ...snapshot.digest,
          newVacancies: 0,
          applicationsWaitingOver7Days: 0,
          nextInterview: null,
        },
        sinceLastVisit: {
          since: '2026-09-23T09:00:00.000Z',
          items: [],
          newVacanciesCount: 0,
          applicationsWaitingOver7Days: 0,
          nearestInterview: null,
        },
      },
    });
    expect(htmlNothingNew).not.toContain('career-today-return-banner');
  });

  it('shows since-last-visit facts as a hint line under the queue title, not a separate block (C55)', () => {
    const html = renderTodayScreen({
      snapshot: {
        ...snapshot,
        sinceLastVisit: { since: null, items: ['Genetec запросили доступность на этой неделе'] },
      },
    });

    expect(html).toContain('career-today-since-hint');
    expect(html).toContain('Genetec запросили доступность на этой неделе');
    // No separate «С прошлого визита» section duplicating the KPI tiles.
    expect(html).not.toContain('career-today-since"');
  });

  it('shows a skeleton while the first reading is in flight', () => {
    const html = renderTodayScreen({ snapshot: null, loading: true });

    expect(html).toContain('aria-label="Читаем очередь дня"');
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/career-today-digest-card/gu)).toHaveLength(4);
  });

  it('shows a retry action when the reading failed', () => {
    const html = renderTodayScreen({ snapshot: null, failed: true });

    expect(html).toContain('Не удалось обновить очередь дня');
    expect(html).toContain('Повторить');
  });

  it('keeps the digest and says what to do when the queue is empty', () => {
    const html = renderTodayScreen({
      snapshot: {
        ...snapshot,
        queue: [],
        followUps: [],
        sinceLastVisit: { since: null, items: [] },
      },
    });

    expect(html).toContain('Очередь дня');
    expect(html).toContain('career-today-digest');
    expect(html).toContain('Решений на сегодня нет: подборка разобрана.');
    expect(html).toContain('Новые вакансии появятся здесь сами.');
  });

  describe('Консультант на «Сегодня» (C57)', () => {
    const mockAction: Parameters<typeof TodayScreen>[0]['consultantAction'] = {
      revision: 'career-action-policy-v1-2026-08-07',
      type: 'review',
      destination: 'profile',
      headline: 'Добавим полный источник',
      label: 'Дополнить профиль',
      rationale: 'Сначала закрываем «материала недостаточно для полного разбора».',
      expectedChange: 'Полный источник откроет недостающие даты, задачи и результаты.',
      findingIds: ['readability-short'],
      roleIds: ['role-target'],
      marketIds: ['eu', 'mena'],
      alternatives: [],
      approvalBoundary: 'Профиль меняется только после согласования.',
    };

    it('оставляет единственную акцентную кнопку консультанта при наличии интервью', () => {
      const html = renderTodayScreen({
        consultantAction: { ...mockAction, label: 'Проверить факты' },
        snapshot: { ...snapshot, queue: [...snapshot.queue, {
          kind: 'interview', applicationId: 'interview-one', title: 'Product Lead',
          company: 'Компания', eyebrow: 'Интервью', dueAt: null, fit: null,
        }] },
      });
      const accentButtons = html.match(/<button[^>]*class="[^"]*career-btn-primary[^"]*"[^>]*>[\s\S]*?<\/button>/gu) ?? [];
      expect(accentButtons).toHaveLength(1);
      expect(accentButtons[0]).toContain('Проверить факты');
      expect(html).toContain('Подготовиться');
    });

    it('встраивает карточку консультанта в очередь дня с заголовком, обоснованием и кнопкой действия', () => {
      const html = renderTodayScreen({ consultantAction: mockAction });

      expect(html).toContain('career-today-consultant-card');
      expect(html).toContain('Консультант · Один шаг на сегодня');
      expect(html).toContain('Добавим полный источник');
      expect(html).toContain('Сначала закрываем «материала недостаточно для полного разбора».');
      expect(html).toContain('Что изменится:');
      expect(html).toContain('Полный источник откроет недостающие даты, задачи и результаты.');
      expect(html).toContain('Дополнить профиль');
      expect(html).toContain('Отклонить предложение');
      // Total cards count in queue increases
      expect(html).toContain('3 карточки · решение нужно по каждой');
    });

    it('показывает карточку консультанта в пустой очереди вместо заглушки «Решений на сегодня нет»', () => {
      const html = renderTodayScreen({
        snapshot: {
          ...snapshot,
          queue: [],
          followUps: [],
          sinceLastVisit: { since: null, items: [] },
        },
        consultantAction: mockAction,
      });

      expect(html).toContain('career-today-consultant-card');
      expect(html).toContain('Добавим полный источник');
      expect(html).toContain('1 карточка · решение нужно по каждой');
      expect(html).not.toContain('Решений на сегодня нет: подборка разобрана.');
    });

    it('не показывает отклонённое или принятое предложение консультанта', () => {
      const testCandId = 'cand-c57-test';
      resolveConsultantAction(testCandId, mockAction, 'dismissed');

      const html = renderTodayScreen({
        candidateId: testCandId,
        consultantAction: mockAction,
      });

      expect(html).not.toContain('career-today-consultant-card');
      expect(html).toContain('2 карточки · решение нужно по каждой');

      clearConsultantActionResolution(testCandId, mockAction);
    });

    it('маршрутизирует read-only действия в правильные разделы кабинета', () => {
      expect(consultantTargetView('profile')).toBe('profile');
      expect(consultantTargetView('evidence')).toBe('profile');
      expect(consultantTargetView('coach')).toBe('profile');
      expect(consultantTargetView('career')).toBe('career');
      expect(consultantTargetView('search')).toBe('opportunities');
    });
  });
});


describe('queueItemTarget (B331: «Открыть» was a button without a handler)', () => {
  it('opens vacancies for a vacancy card and responses for an application card', () => {
    const [followUp, vacancy] = snapshot.queue;
    expect(queueItemTarget(vacancy)).toBe('opportunities');
    expect(queueItemTarget({ ...vacancy, kind: 'shortlist' })).toBe('opportunities');
    expect(queueItemTarget({ ...followUp, kind: 'candidate_turn' })).toBe('responses');
  });
});
