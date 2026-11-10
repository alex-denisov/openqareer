// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import * as openExternalLinkModule from '../../services/desktop/openExternalLink';
import { VacancyRow } from './VacancyRow';
import { VacancyDetailPanel } from './VacancyDetailPanel';
import { LetterActions } from './VacancyLetterActions';
import { vacancyRowPushProps } from './VacancyMobilePush';
import { letterPlatform } from './VacancyLetterScreen';
import { letterHostProps } from './vacancyLetterHost';
import type { VacancyApplications } from './useVacancyApplications';
import type { ApprovalState } from './vacancyLetterController';

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

function click(text: string) {
  const found = button(text);
  if (!found) throw new Error(`no button ${text}`);
  act(() => found.click());
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-11-10T09:00:00.000Z';

describe('B629: «Откликнуться» opens the letter', () => {
  it.each(['screen', 'default'] as const)(
    'the expanded %s row opens the cold letter (circle 3), not the platform',
    (layout) => {
      const openSpy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
      const onOpenLetter = vi.fn();
      const apps = applications();
      mount(
        <VacancyRow
          layout={layout}
          item={item()}
          now={NOW}
          isSelected
          onSelect={vi.fn()}
          applications={apps}
          onOpenLetter={onOpenLetter}
        />,
      );
      click('Откликнуться');
      expect(onOpenLetter).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }), 3);
      expect(openSpy).not.toHaveBeenCalled();
      expect(apps.record).not.toHaveBeenCalled();
      expect(button('Да, отклик отправлен')).toBeUndefined();
    },
  );

  it('keeps the apply button live without a platform link: the letter needs none', () => {
    mount(
      <VacancyRow
        layout="screen"
        item={item({ primaryUrl: '' })}
        now={NOW}
        isSelected
        onSelect={vi.fn()}
        onOpenLetter={vi.fn()}
      />,
    );
    expect(button('Откликнуться')?.disabled).toBe(false);
  });

  it('«На площадке» only opens the vacancy: no letter, no mark', () => {
    const openSpy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
    const onOpenLetter = vi.fn();
    const apps = applications();
    mount(
      <VacancyRow
        layout="screen"
        item={item()}
        now={NOW}
        isSelected
        onSelect={vi.fn()}
        applications={apps}
        onOpenLetter={onOpenLetter}
      />,
    );
    click('На площадке');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/vacancy');
    expect(onOpenLetter).not.toHaveBeenCalled();
    expect(apps.record).not.toHaveBeenCalled();
    expect(button('Да, отклик отправлен')).toBeUndefined();
  });

  it('an already marked response leads to «Отклики»', () => {
    const onOpenResponses = vi.fn();
    const onOpenLetter = vi.fn();
    mount(
      <VacancyRow
        layout="screen"
        item={item()}
        now={NOW}
        isSelected
        onSelect={vi.fn()}
        applications={applications('applied')}
        onOpenLetter={onOpenLetter}
        onOpenResponses={onOpenResponses}
      />,
    );
    expect(button('Откликнуться')).toBeUndefined();
    click('Перейти в «Отклики»');
    expect(onOpenResponses).toHaveBeenCalled();
    expect(onOpenLetter).not.toHaveBeenCalled();
  });

  it('the detail panel opens the letter when the host lends one', () => {
    const openSpy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
    const onOpenLetter = vi.fn();
    mount(
      <VacancyDetailPanel
        item={item()}
        now={NOW}
        onBack={vi.fn()}
        applications={applications()}
        onOpenLetter={onOpenLetter}
      />,
    );
    click('Откликнуться');
    expect(onOpenLetter).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }), 3);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('the 390 push applies through the letter, even without a platform link', () => {
    const onApplyLetter = vi.fn();
    const props = vacancyRowPushProps(
      item({ primaryUrl: '' }),
      { onSelect: vi.fn() },
      {
        applicationArchived: false,
        alreadyApplied: false,
        externalOpened: false,
        applyOpensLetter: true,
        handleApply: onApplyLetter,
        handleConfirmSent: vi.fn(),
        setInfoOpen: vi.fn(),
      },
      {},
    );
    expect(props.applyLabel).toBe('Откликнуться');
    expect(props.applyDisabled).toBe(false);
    props.onApply();
    expect(onApplyLetter).toHaveBeenCalled();
  });
});

describe('B629: the letter leads to the platform after approval', () => {
  const approved = {
    busy: false,
    error: '',
    saved: { approvedAt: '2026-11-10T09:00:00.000Z' },
    approve: vi.fn(),
    reset: vi.fn(),
  } as unknown as ApprovalState;

  it('after «Одобрить письмо» opens the platform and asks whether the response was sent', () => {
    const openSpy = vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
    const onConfirmSent = vi.fn().mockResolvedValue(undefined);
    mount(
      <LetterActions
        approval={approved}
        pitchReady
        platform={{ url: 'https://example.com/vacancy', applied: false, onConfirmSent }}
      />,
    );
    expect(document.body.textContent).not.toContain('Отклик отправлен?');
    click('Открыть площадку');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/vacancy');
    expect(document.body.textContent).toContain('Отклик отправлен?');
    expect(onConfirmSent).not.toHaveBeenCalled();
    click('Да, отклик отправлен');
    expect(onConfirmSent).toHaveBeenCalled();
  });

  it('shows no platform step on a draft or without a platform link', () => {
    const draft = { ...approved, saved: null } as unknown as ApprovalState;
    mount(
      <LetterActions
        approval={draft}
        pitchReady
        platform={{ url: 'https://example.com/vacancy', applied: false, onConfirmSent: vi.fn() }}
      />,
    );
    expect(button('Открыть площадку')).toBeUndefined();
    act(() => root?.unmount());
    host?.remove();
    mount(
      <LetterActions
        approval={approved}
        pitchReady
        platform={{ url: '', applied: false, onConfirmSent: vi.fn() }}
      />,
    );
    expect(button('Открыть площадку')).toBeUndefined();
    root = undefined;
  });

  it('a failed save says so and keeps the question', async () => {
    vi.spyOn(openExternalLinkModule, 'openExternalLink').mockResolvedValue(true);
    const onConfirmSent = vi.fn().mockRejectedValue(new Error('write_failed'));
    mount(
      <LetterActions
        approval={approved}
        pitchReady
        platform={{ url: 'https://example.com/vacancy', applied: false, onConfirmSent }}
      />,
    );
    click('Открыть площадку');
    await act(async () => button('Да, отклик отправлен')?.click());
    expect(document.body.textContent).toContain(
      'Не удалось сохранить отклик. Состояние не изменено.',
    );
    expect(button('Да, отклик отправлен')?.disabled).toBe(false);
  });

  it('a marked response does not ask again', () => {
    mount(
      <LetterActions
        approval={approved}
        pitchReady
        platform={{ url: 'https://example.com/vacancy', applied: true, onConfirmSent: vi.fn() }}
      />,
    );
    expect(button('Открыть площадку')).toBeUndefined();
    expect(document.body.textContent).toContain('Отклик отмечен');
  });
});

describe('B629: the letter screen records the response like the row', () => {
  it('passes the host applications through and marks the vacancy as applied', () => {
    const apps = applications();
    const host = letterHostProps({ applications: apps });
    const platform = letterPlatform(item().cluster, host.applications);
    expect(platform).toMatchObject({ url: 'https://example.com/vacancy', applied: false });
    void platform.onConfirmSent?.();
    expect(apps.recordConfirmed).toHaveBeenCalledWith('c-1', 'applied', {
      title: 'Head of Platform',
      company: 'Вектор Банк',
      url: 'https://example.com/vacancy',
      source: 'hh-1',
    });
    expect(letterPlatform(item().cluster, applications('applied')).applied).toBe(true);
    expect(letterPlatform(item().cluster).onConfirmSent).toBeUndefined();
  });
});
