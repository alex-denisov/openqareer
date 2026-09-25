import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TodayScreen } from './TodayScreen';
import type { TodaySnapshot } from './todayApi';

const snapshot: TodaySnapshot = {
  digest: {
    waitingForYou: 2,
    newVacancies: 3,
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
    followUpCaptions: ['Peraton — 6 рабочих дней тишины', 'Genetec — обещанный срок истёк'],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-1',
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      eyebrow: 'Follow-up · 6 рабочих дней без ответа',
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
      fit: { role: 'target', level: 'target', geo: true },
    },
  ],
  followUps: [
    { applicationId: 'app-1', company: 'Peraton', title: 'Enterprise Architect', status: 'today' },
  ],
  sinceLastVisit: {
    since: '2026-09-23T09:00:00.000Z',
    items: ['Genetec запросили доступность на этой неделе'],
  },
  vacanciesPending: false,
};

function renderTodayScreen(props: Partial<Parameters<typeof TodayScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayScreen snapshot={snapshot} loading={false} failed={false} onRetry={vi.fn()} {...props} />,
  );
}

describe('TodayScreen (B251 S5)', () => {
  it('shows the digest counters with a basis caption under each number', () => {
    const html = renderTodayScreen();

    expect(html).toContain('3</span>');
    expect(html).toContain('кампания VP Technology Ops');
    expect(html).toContain('Peraton — 6 рабочих дней тишины');
    expect(html).toContain('HRTx Inc. · раунд 2');
  });

  it('marks the first queue row with an accent border, not an overlapping flag', () => {
    const html = renderTodayScreen();

    expect(html).toContain('career-today-item is-first');
    expect(html).not.toContain('Следующее действие');
  });

  it('shows fit checks for a new vacancy and the action buttons per kind', () => {
    const html = renderTodayScreen();

    expect(html).toContain('роль');
    expect(html).toContain('Написать сейчас');
    expect(html).toContain('Открыть');
  });

  it('renders follow-ups by due date and the since-last-visit digest', () => {
    const html = renderTodayScreen();

    expect(html).toContain('Follow-up по срокам');
    expect(html).toContain('Peraton — Enterprise Architect');
    expect(html).toContain('сегодня');
    expect(html).toContain('С прошлого визита');
    expect(html).toContain('Genetec запросили доступность на этой неделе');
  });

  it('shows a skeleton while the first reading is in flight', () => {
    const html = renderTodayScreen({ snapshot: null, loading: true });

    expect(html).toContain('aria-label="Читаем очередь дня"');
    expect(html).toContain('aria-busy="true"');
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
    expect(html).toContain('Добавьте роль или регион');
    expect(html).not.toContain('Новых вакансий с прошлого визита нет');
  });
});
