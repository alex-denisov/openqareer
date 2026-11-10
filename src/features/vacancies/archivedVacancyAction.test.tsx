// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyRow } from './VacancyRow';
import { vacancyRowPushProps } from './VacancyMobilePush';
import type { VacancyApplications } from './useVacancyApplications';

vi.mock('./vacancyFitApi', () => ({
  readVacancyFit: vi.fn(() => new Promise(() => undefined)),
  requestVacancyFit: vi.fn(() => new Promise(() => undefined)),
}));

function item(overrides: Partial<MatchedVacancyItem['cluster']> = {}): MatchedVacancyItem {
  return {
    cluster: {
      id: 'c-1',
      canonicalTitle: 'Head of Platform',
      canonicalCompany: 'Вектор Банк',
      canonicalLocation: 'Москва',
      isRemote: true,
      salary: null,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.com/vacancy',
      sources: [
        { sourceType: 'hh', sourceId: 'hh-1', sourceName: 'hh.ru', sourceUrl: '', observedAt: '' },
      ],
      firstObservedAt: '2026-11-09T08:00:00.000Z',
      lastSeenAt: '2026-11-10T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      ...overrides,
    } as MatchedVacancyItem['cluster'],
    explanation: {
      clusterId: 'c-1',
      roleMatch: 'target',
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-11-10T08:00:00.000Z',
    },
  };
}

function applications(status?: 'applied'): VacancyApplications {
  const byCluster = new Map(status ? [['c-1', { clusterId: 'c-1', status } as never]] : []);
  return {
    applications: [],
    byCluster,
    unsaved: new Set<string>(),
    record: vi.fn(),
    recordConfirmed: vi.fn().mockResolvedValue(undefined),
  };
}

let root: Root | undefined;
let host: HTMLElement | undefined;

function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => created.render(node));
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-11-10T09:00:00.000Z';
const ARCHIVED = new Set(['c-1']);

describe('B631: an archived vacancy has one action — «Вернуть из архива»', () => {
  it('the expanded card shows only the restore button, no interview or letter', async () => {
    const onRestoreFromArchive = vi.fn().mockResolvedValue(undefined);
    mount(
      <VacancyRow
        layout="screen"
        item={item()}
        now={NOW}
        isSelected
        onSelect={vi.fn()}
        applications={applications('applied')}
        archivedApplicationClusterIds={ARCHIVED}
        onScheduleInterview={vi.fn()}
        onOpenArchive={vi.fn()}
        onOpenLetter={vi.fn()}
        onRestoreFromArchive={onRestoreFromArchive}
      />,
    );
    const actions = document.querySelector('.vacancies-screen-detail-actions');
    const labels = Array.from(actions?.querySelectorAll('button') ?? []).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['Вернуть из архива']);
    expect(button('Назначили интервью')).toBeUndefined();
    expect(document.body.textContent).not.toContain('Отклик отмечен');
    await act(async () => button('Вернуть из архива')?.click());
    expect(onRestoreFromArchive).toHaveBeenCalledWith('c-1');
  });

  it('a failed restore says so and keeps the button', async () => {
    mount(
      <VacancyRow
        layout="screen"
        item={item()}
        now={NOW}
        isSelected
        onSelect={vi.fn()}
        applications={applications('applied')}
        archivedApplicationClusterIds={ARCHIVED}
        onRestoreFromArchive={vi.fn().mockRejectedValue(new Error('conflict'))}
      />,
    );
    await act(async () => button('Вернуть из архива')?.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось вернуть отклик из архива',
    );
    expect(button('Вернуть из архива')?.disabled).toBe(false);
  });

  it('the 390 push offers the same single action', () => {
    const onRestoreFromArchive = vi.fn().mockResolvedValue(undefined);
    const props = vacancyRowPushProps(
      item(),
      { onSelect: vi.fn(), onOpenArchive: vi.fn(), onRestoreFromArchive },
      {
        applicationArchived: true,
        alreadyApplied: true,
        externalOpened: false,
        handleApply: vi.fn(),
        handleConfirmSent: vi.fn(),
        setInfoOpen: vi.fn(),
      },
      {},
    );
    expect(props.applyLabel).toBe('Вернуть из архива');
    expect(props.applyDisabled).toBe(false);
    props.onApply();
    expect(onRestoreFromArchive).toHaveBeenCalledWith('c-1');
  });
});
