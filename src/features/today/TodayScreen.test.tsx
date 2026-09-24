import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TodayScreen } from './TodayScreen';
import type { TodaySnapshot } from './todayApi';

const snapshot: TodaySnapshot = {
  digest: { waitingForYou: 2, newVacancies: 3, closedVacancies: 1 },
  queue: [
    { kind: 'candidate_turn', applicationId: 'app-1', title: 'Ответьте HR в Acme', dueAt: null },
    { kind: 'new_vacancy', clusterId: 'cl-1', title: 'VP Technology Ops в Beta', dueAt: null },
  ],
  sinceLastVisit: null,
  vacanciesPending: false,
};

function renderTodayScreen(props: Partial<Parameters<typeof TodayScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayScreen snapshot={snapshot} loading={false} failed={false} onRetry={vi.fn()} {...props} />,
  );
}

describe('TodayScreen (B251 S5)', () => {
  it('shows the digest counters', () => {
    const html = renderTodayScreen();

    expect(html).toContain('3 новые вакансии');
    expect(html).toContain('ждут вашего ответа');
    expect(html).toContain('1 вакансия закрылась');
  });

  it('marks the first queue row as the next action, not just another item', () => {
    const html = renderTodayScreen();
    const firstRowIndex = html.indexOf('<li');
    const secondRowIndex = html.indexOf('<li', firstRowIndex + 1);

    expect(html.slice(firstRowIndex, secondRowIndex)).toContain('Следующее действие');
    expect(html.slice(firstRowIndex, secondRowIndex)).toContain('Ответьте HR в Acme');
    expect(html.slice(secondRowIndex)).not.toContain('Следующее действие');
  });

  it('says the pool is still updating instead of an empty digest', () => {
    const html = renderTodayScreen({ snapshot: { ...snapshot, vacanciesPending: true } });

    expect(html).toContain('Подбор обновляется');
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

  it('says the queue is empty rather than showing nothing', () => {
    const html = renderTodayScreen({ snapshot: { ...snapshot, queue: [] } });

    expect(html).toContain('Очередь пуста — новых решений на сегодня нет.');
  });
});
