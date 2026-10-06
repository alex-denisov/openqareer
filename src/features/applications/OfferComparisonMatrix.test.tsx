// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { OfferComparisonMatrix } from './OfferComparisonMatrix';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseApp: ApplicationView = {
  id: 'app-1',
  candidateId: 'cand-1',
  clusterId: null,
  stage: 'offer',
  closedReason: null,
  archiveReason: null,
  archivePreviousStage: null,
  processProfile: 'standard',
  notes: null,
  followUpDueAt: null,
  stageChangedAt: '2026-02-01T10:00:00.000Z',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
  version: 1,
  archiveStaleDays: 30,
  vacancy: {
    title: 'Старший инженер',
    company: 'Яндекс',
    source: 'hh',
    url: 'https://hh.ru/1',
  },
  whoseTurn: 'candidate',
  followUp: null,
  materials: { coverLetter: true, resume: true },
  nearestInterview: null,
  offer: {
    applicationId: 'app-1',
    terms: {
      baseSalary: 300_000,
      salaryPeriod: 'month',
      bonus: 600_000,
      currency: 'RUB',
      format: 'remote',
      benefits: ['ДМС со стоматологией', 'Техника'],
      risks: ['Высокая нагрузка'],
    },
    respondBy: '2026-03-01',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
  },
};

const secondApp: ApplicationView = {
  ...baseApp,
  id: 'app-2',
  vacancy: {
    title: 'Руководитель группы',
    company: 'Т-Банк',
    source: 'recruiter',
    url: '',
  },
  offer: {
    applicationId: 'app-2',
    terms: {
      baseSalary: 400_000,
      salaryPeriod: 'month',
      bonus: 800_000,
      currency: 'RUB',
      format: 'hybrid',
      probationPeriodMonths: 3,
      probationSalary: 350_000,
      benefits: ['ДМС', 'Спорт'],
      risks: ['Офис 3 дня в неделю'],
      sourceNote: 'со слов кандидата',
    },
    respondBy: '2026-03-05',
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
  },
};

describe('OfferComparisonMatrix', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders static markup comparing two offers with formula compensation numbers', () => {
    const html = renderToStaticMarkup(
      <OfferComparisonMatrix
        applications={[baseApp, secondApp]}
        onClose={() => {}}
        onEditOffer={() => {}}
      />,
    );

    const normalizedHtml = html.replace(/\u00A0/g, ' ');
    expect(normalizedHtml).toContain('Сравнение офферов');
    expect(normalizedHtml).toContain('Яндекс');
    expect(normalizedHtml).toContain('Т-Банк');
    // Яндекс: 300_000 * 12 + 600_000 = 4_200_000
    expect(normalizedHtml).toContain('4 200 000');
    // Т-Банк: 3 * 350_000 + 9 * 400_000 + 800_000 = 1_050_000 + 3_600_000 + 800_000 = 5_450_000
    expect(normalizedHtml).toContain('5 450 000');
    // Source labels "со слов кандидата" must be present for numbers without external proof
    expect(normalizedHtml).toContain('со слов кандидата');
  });

  it('highlights the offer with the highest total compensation', () => {
    const html = renderToStaticMarkup(
      <OfferComparisonMatrix
        applications={[baseApp, secondApp]}
        onClose={() => {}}
        onEditOffer={() => {}}
      />,
    );

    expect(html).toContain('Лидер по доходу');
  });

  it('triggers onEditOffer when clicking edit button for an offer', () => {
    const onEdit = vi.fn();
    act(() => {
      root.render(
        <OfferComparisonMatrix
          applications={[baseApp, secondApp]}
          onClose={() => {}}
          onEditOffer={onEdit}
        />,
      );
    });

    const editButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[data-testid="edit-offer-btn"]',
    );
    // 2 in desktop table + 2 in mobile stack
    expect(editButtons.length).toBe(4);
    act(() => {
      editButtons[0].click();
    });
    expect(onEdit).toHaveBeenCalledWith('app-2'); // Sorted by compensation: app-2 is #1
  });

  it('closes on escape or close button click', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <OfferComparisonMatrix
          applications={[baseApp, secondApp]}
          onClose={onClose}
          onEditOffer={() => {}}
        />,
      );
    });

    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[data-testid="close-matrix-btn"]',
    );
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
