import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { queueItemTarget, TodayScreen } from './TodayScreen';
import { todayActionId } from './consultantActionStorage';
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
    {
      applicationId: 'app-2',
      company: 'Genetec',
      title: 'Enterprise Architect',
      status: 'overdue',
    },
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

function mobileTodayMarkup(html: string): string {
  const start = html.indexOf('<div class="career-today-mobile');
  const end = html.indexOf('<div class="career-today-desktop">', start);
  return start >= 0 && end > start ? html.slice(start, end) : html;
}

describe('TodayScreen (ACC-A-1)', () => {
  const action: NonNullable<Parameters<typeof TodayScreen>[0]['consultantAction']> = {
    revision: 'career-action-policy-v1-2026-08-07',
    type: 'review',
    destination: 'profile',
    headline: 'Подтвердите размер команды',
    label: 'Подтвердить факт',
    rationale: 'Проверьте исходные данные профиля.',
    expectedChange: 'Откроется оценка уровня для вакансий.',
    findingIds: ['team-size'],
    roleIds: ['role-target'],
    marketIds: ['market-target'],
    alternatives: [],
    approvalBoundary: 'Изменения требуют подтверждения.',
  };

  it('renders the approved decision, queue, funnel and profile shortcut', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        consultantAction: action,
        onNavigate: vi.fn(),
        onOpenExpert: vi.fn(),
      }),
    );

    expect(html).toContain('class="tm-hero is-decision"');
    expect(html).toContain('Подтвердите размер команды');
    expect(html).toContain('Подтвердить факт');
    expect(html).toContain('Отложить до завтра');
    expect(html).toContain('Почему это решение');
    expect(html).toContain('Очередь дня');
    expect(html.match(/data-testid="today-mobile-queue-row"/gu)).toHaveLength(2);
    expect(html).toContain('Воронка за 30 дней');
    expect(html).toContain('Избранное');
    expect(html).toContain('Дополнить профиль');
  });

  it('hides the current consultant action when the server snapshot says it is deferred', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        consultantAction: action,
        snapshot: {
          ...snapshot,
          todayActionDeferral: {
            actionId: todayActionId(action),
            deferredThroughDate: '2026-10-17',
          },
        },
      }),
    );

    expect(html).toContain('Нет проверенного следующего шага');
    expect(html).not.toContain('Подтвердите размер команды');
    expect(html).not.toContain('Отложить до завтра');
  });

  it('does not display a recruiter name as the company in a mobile queue row', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        snapshot: {
          ...snapshot,
          queue: [
            {
              ...snapshot.queue[1],
              company: 'Глушкова Ксения Евгеньевна',
            },
          ],
        },
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain('Компания не указана — Business Information Architect');
    expect(html).not.toContain('Глушкова');
  });

  it('does not repeat removed legacy modules on mobile', () => {
    const html = mobileTodayMarkup(renderTodayScreen());

    expect(html).not.toContain('career-today-return-banner');
    expect(html).not.toContain('career-today-digest');
    expect(html).not.toContain('career-momentum-widget');
    expect(html).not.toContain('career-today-since-hint');
    expect(html).not.toContain('career-drafts');
    expect(html).not.toContain('career-today-followups');
    expect(html).not.toContain('career-onboarding');
    expect(html).not.toContain('Открыть карьерный дневник');
  });

  it('shows zero, one or at most four queue rows', () => {
    const emptyHtml = mobileTodayMarkup(
      renderTodayScreen({ snapshot: { ...snapshot, queue: [] } }),
    );
    const oneHtml = mobileTodayMarkup(
      renderTodayScreen({ snapshot: { ...snapshot, queue: [snapshot.queue[0]] } }),
    );
    const twentyQueue = Array.from({ length: 20 }, (_, index) => ({
      ...snapshot.queue[0],
      applicationId: 'queue-' + index,
      title: 'Enterprise Architect ' + index,
    }));
    const manyHtml = mobileTodayMarkup(
      renderTodayScreen({ snapshot: { ...snapshot, queue: twentyQueue } }),
    );
    const rowCount = (html: string) =>
      html.match(/data-testid="today-mobile-queue-row"/gu)?.length ?? 0;

    expect(rowCount(emptyHtml)).toBe(0);
    expect(rowCount(oneHtml)).toBe(1);
    expect(rowCount(manyHtml)).toBe(4);
    expect(manyHtml).not.toContain('Enterprise Architect 4');
    expect(manyHtml).not.toContain('Показать ещё');
  });

  it('marks an overdue follow-up row without relying on color alone', () => {
    const overdueItem = { ...snapshot.queue[0], applicationId: 'app-2' };
    const html = mobileTodayMarkup(
      renderTodayScreen({
        snapshot: { ...snapshot, queue: [overdueItem] },
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain('class="pm-row is-warn"');
    expect(html).toContain('Срок вышел');
  });

  it('shows funnel counts with their source date and sample size', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        snapshot: {
          ...snapshot,
          momentum: {
            calculatedAt: '2026-10-07T09:12:00.000Z',
            windows: {
              '7d': { applied: 2, views: 'unknown', screenings: 'unknown', interviews: 0 },
              '30d': { applied: 7, views: 'unknown', screenings: 'unknown', interviews: 2 },
            },
            evidence: {
              '7d': {
                startAt: '2026-09-30T09:12:00.000Z',
                endAt: '2026-10-07T09:12:00.000Z',
                applied: { source: 'application_events.recorded_at', sampleSize: 2 },
                views: { source: 'unavailable', sampleSize: 0, unknownReason: 'no_source' },
                screenings: { source: 'unavailable', sampleSize: 0, unknownReason: 'no_source' },
                interviews: { source: 'candidate_interview_schedules.scheduled_at', sampleSize: 0 },
              },
              '30d': {
                startAt: '2026-09-07T09:12:00.000Z',
                endAt: '2026-10-07T09:12:00.000Z',
                applied: { source: 'application_events.recorded_at', sampleSize: 7 },
                views: { source: 'unavailable', sampleSize: 0, unknownReason: 'no_source' },
                screenings: { source: 'unavailable', sampleSize: 0, unknownReason: 'no_source' },
                interviews: { source: 'candidate_interview_schedules.scheduled_at', sampleSize: 2 },
              },
            },
            burnoutNotice: false,
          },
        },
      }),
    );
    const funnel = html.slice(html.indexOf('class="tm-funnel"'));

    expect(funnel).toContain('class="is-here"');
    expect(funnel).toContain('aria-current="step"');
    expect(funnel).toContain('Откликов меньше 10 (n = 7): выводов о конверсии нет.');
    expect(funnel).toMatch(/Данные на \d{2}\.\d{2} \d{2}:\d{2}\./u);
    expect(funnel).toContain(
      'Нет проверенных данных по этапам: «Найдено», «В избранном», «Ответов», «Офферов».',
    );
  });

  it('follows the approved mobile funnel copy when every stage has a source', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        funnelContext: { found: 214 },
        snapshot: {
          ...snapshot,
          funnel: { favorites: 18, responses: 3, offers: 0 },
        },
      } as never),
    );
    const funnel = html.slice(html.indexOf('class="tm-funnel"'));
    expect([...funnel.matchAll(/<b class="num">([^<]+)<\/b>/gu)].map((match) => match[1])).toEqual([
      '18',
      '—',
      '3',
      '—',
    ]);
    expect(funnel).toContain('Найдено в каталоге: 214. Офферов пока 0.');
  });

  it('shows dashes and an explicit unknown state for metrics without verified data', () => {
    const html = mobileTodayMarkup(renderTodayScreen());
    const funnel = html.slice(html.indexOf('class="tm-funnel"'));

    expect(funnel.match(/>—<\/b>/gu)).toHaveLength(4);
    expect(funnel).toContain('Нет проверенных данных');
    expect(funnel).not.toContain('class="is-here"');
  });

  it('uses the desktop empty-decision copy and keeps a real consultant route', () => {
    const html = mobileTodayMarkup(
      renderTodayScreen({
        onOpenExpert: vi.fn(),
      }),
    );

    expect(html).toContain('Нет проверенного следующего шага');
    expect(html).toContain('В текущих данных нет основания предложить конкретное действие.');
    expect(html).toContain('Обсудить');
    expect(html).not.toContain('Сейчас нечего решать');
    expect(html).not.toContain('Подтвердить факт');
    expect(html).not.toContain('Отложить до завтра');
  });

  it('shows a mobile skeleton while the first reading is in flight', () => {
    const html = renderTodayScreen({ snapshot: null, loading: true });

    expect(html).toContain('aria-label="Читаем очередь дня"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('today-loading-mobile');
    expect(html).not.toContain('today-loading-desktop career-today-digest');
  });

  it('offers vacancies and a goal talk when there is no decision and the queue is empty', () => {
    const html = renderTodayScreen({
      snapshot: { ...snapshot, queue: [], followUps: [] },
      consultantAction: undefined,
      onNavigate: vi.fn(),
      onOpenExpert: vi.fn(),
    });

    expect(html.match(/Сейчас нечего решать\. Очередь пуста\./gu)?.length).toBe(2);
    expect(html).toContain('Открыть вакансии');
    expect(html).toContain('Обсудить цель');
    expect(html).not.toContain('Нет проверенного следующего шага');
  });

  it('shows a working retry control when loading fails', () => {
    const html = renderTodayScreen({ snapshot: null, failed: true });

    expect(html).toContain('Не удалось собрать очередь: сервер не ответил.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Часть данных ещё обновляется');
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
