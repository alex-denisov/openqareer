// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsesBoard } from './ResponsesBoard';
import type { ApplicationView } from './applicationsApi';
import type { UseApplications } from './useApplications';

// B632: «Отклики» on 10.11; Snowflake was sent on 01.10, beyond the 30-day period.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function application(
  id: string,
  company: string,
  overrides: Partial<ApplicationView>,
): ApplicationView {
  return {
    id,
    candidateId: 'c1',
    clusterId: 'cl-' + id,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'Director of Engineering', company, url: 'https://x', source: 'linkedin' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-11-08T10:00:00.000Z',
    version: 1,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

const FIRSTRADE = application('firstrade', 'Firstrade', {});
const SNOWFLAKE = application('snowflake', 'Snowflake', {
  createdAt: '2026-10-01T10:00:00.000Z',
  stageChangedAt: '2026-10-01T10:00:00.000Z',
  whoseTurn: 'candidate',
  followUp: {
    dueAt: '2026-10-08T00:00:00',
    urgency: 'overdue',
    source: 'standard_schedule',
    daysSinceContact: 40,
  } as ApplicationView['followUp'],
});
const INTOUCH = application('intouch', 'Intouch', {
  stage: 'interview',
  createdAt: '2026-09-25T10:00:00.000Z',
});
const OLD_ARCHIVED = application('old-archived', 'Northwind', {
  stage: 'archived',
  whoseTurn: null,
  createdAt: '2026-09-01T10:00:00.000Z',
});

function readyState(applications: readonly ApplicationView[]): UseApplications {
  return {
    status: 'ready',
    applications,
    offline: false,
    failedChanges: new Map(),
    conflicts: new Set(),
    reload: () => {},
    refreshApplications: async () => applications,
    changeStage: () => {},
    restoreFromArchive: async () => {},
    scheduleInterview: async () => {},
    retryStageChange: () => {},
    markFollowUpSent: async () => {},
    saveNote: () => {},
    addManualCard: async () => FIRSTRADE,
    skip: async () => {},
    saveOffer: async () => {},
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(applications: readonly ApplicationView[], initialApplicationId?: string) {
  act(() => {
    root.render(
      <ResponsesBoard
        state={readyState(applications)}
        onOpenVacancies={() => {}}
        initialApplicationId={initialApplicationId}
      />,
    );
  });
}

function selectedPanel(): string {
  return container.querySelector('.career-responses-selected')?.textContent ?? '';
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label || item.textContent?.trim().endsWith(label),
  );
  if (!button) throw new Error('No button ' + label);
  act(() => button.click());
}

describe('«Отклики»: open responses ignore the period (B632)', () => {
  it('shows old open responses by default and counts the one that needs the candidate', () => {
    render([FIRSTRADE, SNOWFLAKE, INTOUCH, OLD_ARCHIVED]);
    const text = container.textContent ?? '';
    expect(text).toContain('Snowflake');
    expect(text).toContain('Intouch');
    expect(text).toContain('1нужно действие');
    expect(text).toContain('Напомнить компании про ответ, срок был 08.10');
  });

  it('lands on the response from «Сегодня» even when it is older than the period', () => {
    render([FIRSTRADE, SNOWFLAKE, INTOUCH], 'snowflake');
    expect(selectedPanel()).toContain('Snowflake');
    expect(selectedPanel()).not.toContain('Firstrade');
  });

  it('widens the period and the stage for a linked closed response', () => {
    render([FIRSTRADE, OLD_ARCHIVED], 'old-archived');
    expect(selectedPanel()).toContain('Northwind');
  });

  it('says how many closed responses the period hides and shows them on click', () => {
    render([FIRSTRADE, OLD_ARCHIVED]);
    clickButton('закрыто');
    expect(container.textContent).toContain('Есть 1 отклик старше 30 дней');
    clickButton('Показать');
    expect(container.textContent).toContain('Northwind');
    expect(container.textContent).not.toContain('Есть 1 отклик старше');
  });
});
