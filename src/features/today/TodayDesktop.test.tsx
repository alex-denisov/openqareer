// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { todaySnapshot } from '../../../e2e/fixtures/readabilityWorkspace';
import { TodayDesktopContent } from './TodayDesktop';

function funnelMomentum(applications: number) {
  const endAt = '2026-10-16T09:00:00.000Z';
  return {
    calculatedAt: endAt,
    windows: {
      '7d': {
        applied: 4,
        views: 'unknown' as const,
        screenings: 'unknown' as const,
        interviews: 1,
      },
      '30d': {
        applied: applications,
        views: 'unknown' as const,
        screenings: 'unknown' as const,
        interviews: 2,
      },
    },
    evidence: {
      '7d': {
        startAt: '2026-10-09T09:00:00.000Z',
        endAt,
        applied: { source: 'application_events.recorded_at' as const, sampleSize: 4 },
        views: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
        screenings: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
        interviews: {
          source: 'candidate_interview_schedules.scheduled_at' as const,
          sampleSize: 1,
        },
      },
      '30d': {
        startAt: '2026-09-16T09:00:00.000Z',
        endAt,
        applied: { source: 'application_events.recorded_at' as const, sampleSize: applications },
        views: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
        screenings: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
        interviews: {
          source: 'candidate_interview_schedules.scheduled_at' as const,
          sampleSize: 2,
        },
      },
    },
    burnoutNotice: false,
  };
}

function funnel(context?: unknown, applications = 7) {
  const root = document.createElement('div');
  const momentum = funnelMomentum(applications);
  const props = {
    snapshot: { ...todaySnapshot, queue: [], followUps: [], momentum },
    ...(context === undefined ? {} : { funnelContext: context }),
    onAccept: () => undefined,
    onPostpone: () => undefined,
  };
  root.innerHTML = renderToStaticMarkup(
    <TodayDesktopContent {...(props as Parameters<typeof TodayDesktopContent>[0])} />,
  );
  return root.querySelector('.career-today-funnel')!;
}

describe('Today funnel values', () => {
  it('routes the Dates action to the existing experience and missing start-date field', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onNavigateProfileTarget = vi.fn();
    const profileDraft = {
      ...EMPTY_RESUME_DRAFT,
      candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Марина Соколова' },
      experience: [
        {
          id: 'experience-fin-nova',
          chronologyMemoryId: 'chronology-fin-nova',
          title: 'Инженер',
          employer: 'FinNova',
          current: true,
          bulletMemoryIds: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <TodayDesktopContent
          snapshot={{ ...todaySnapshot, queue: [], followUps: [] }}
          profileDraft={profileDraft}
          onNavigateProfileTarget={onNavigateProfileTarget}
          onAccept={() => undefined}
          onPostpone={() => undefined}
        />,
      );
    });
    const datesAction = [
      ...container.querySelectorAll<HTMLButtonElement>('button.career-today-profile-action'),
    ].find((button) => button.textContent?.includes('Даты: FinNova'));

    expect(datesAction).toBeDefined();
    await act(async () => {
      datesAction?.click();
    });
    expect(onNavigateProfileTarget).toHaveBeenCalledWith({
      section: 'experience',
      experienceId: 'experience-fin-nova',
      employer: 'FinNova',
      title: 'Инженер',
      field: 'startDate',
    });
    act(() => root.unmount());
  });

  it('loads the approved remainder and passes the exact queue row to discussion', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const queue = Array.from({ length: 5 }, (_, index) => ({
      kind: 'new_vacancy' as const,
      clusterId: `cluster-${index + 1}`,
      title: `Вакансия ${index + 1}`,
      company: 'Компания',
      eyebrow: 'Проверено сегодня',
      dueAt: null,
      fit: null,
    }));
    const onLoadQueueRemainder = vi.fn(async () => undefined);
    const onDiscussQueueItem = vi.fn();

    await act(async () => {
      root.render(
        <TodayDesktopContent
          snapshot={{
            ...todaySnapshot,
            queue,
            followUps: [],
            queueTotal: 12,
            queueRevision: 'b'.repeat(64),
          }}
          onAccept={() => undefined}
          onPostpone={() => undefined}
          onNavigate={() => undefined}
          onLoadQueueRemainder={onLoadQueueRemainder}
          onDiscussQueueItem={onDiscussQueueItem}
        />,
      );
    });
    const more = container.querySelector<HTMLButtonElement>(
      '[data-testid="today-desktop-queue-more"]',
    );
    expect(more?.textContent).toContain('Показать остальные 7');
    await act(async () => {
      more?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.career-today-queue-discuss')?.click();
    });

    expect(onLoadQueueRemainder).toHaveBeenCalledOnce();
    expect(onDiscussQueueItem).toHaveBeenCalledWith(queue[0]);
    act(() => root.unmount());
  });

  it('keeps pending feedback inside the approved queue instead of adding a new screen block', () => {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(
      <TodayDesktopContent
        snapshot={{ ...todaySnapshot, queue: [], followUps: [], vacanciesPending: true }}
        onAccept={() => undefined}
        onPostpone={() => undefined}
      />,
    );
    expect(root.querySelector('.career-today-pending')).toBeNull();
    expect(root.querySelector('#today-queue')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('#today-queue')?.textContent).toContain('Загружаем очередь дня');
  });
  it('keeps the approved desktop caption short; the low-sample note lives on mobile', () => {
    const element = funnel();
    expect(element.querySelector('.career-today-funnel-low-sample')).toBeNull();
    expect(element.querySelector('.career-today-funnel-basis')?.textContent).toMatch(
      /^n = 7 откликов, \d{2}\.\d{2} \d{2}:\d{2}$/u,
    );
  });

  it('draws all six approved stages from their verified sources', () => {
    const root = document.createElement('div');
    const props = {
      snapshot: {
        ...todaySnapshot,
        queue: [],
        followUps: [],
        momentum: funnelMomentum(7),
        funnel: { favorites: 18, responses: 3, offers: 0 },
      },
      funnelContext: { found: 214 },
      onAccept: () => undefined,
      onPostpone: () => undefined,
    };
    root.innerHTML = renderToStaticMarkup(
      <TodayDesktopContent {...(props as Parameters<typeof TodayDesktopContent>[0])} />,
    );
    const element = root.querySelector('.career-today-funnel')!;
    const values = [...element.querySelectorAll('.career-today-funnel-value')].map(
      (e) => e.textContent,
    );
    expect(values).toEqual(['214', '18', '7', '3', '2', '0']);
    const bars = [...element.querySelectorAll('.career-today-funnel-track-fill')].map((e) =>
      Number(e.getAttribute('width')),
    );
    expect(bars[0]).toBe(100);
    expect(bars[2]).toBeCloseTo((7 / 214) * 100);
    expect(element.querySelector('[style]')).toBeNull();
    expect(element.querySelector('.is-current .career-today-funnel-label')?.textContent).toBe(
      'Интервью',
    );
  });

  it('keeps unavailable counts unknown rather than drawing invented zeroes', () => {
    const element = funnel();
    const first = element.querySelector('li')!;
    expect(first.getAttribute('aria-label')).toContain('нет проверенных данных');
    expect(first.querySelector('.career-today-funnel-value')?.textContent).toBe('—');
    expect(first.querySelector('.career-today-funnel-track-fill')).toBeNull();
  });
});
