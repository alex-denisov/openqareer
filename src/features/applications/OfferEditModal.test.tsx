// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { OfferEditModal } from './OfferEditModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testApp: ApplicationView = {
  id: 'app-test-1',
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
    title: 'Lead Architect',
    company: 'TechCorp',
    source: 'hh',
    url: 'https://hh.ru/1',
  },
  whoseTurn: 'candidate',
  followUp: null,
  materials: { coverLetter: true, resume: true },
  nearestInterview: null,
  offer: null,
};

describe('OfferEditModal', () => {
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

  it('renders form inputs and calculates preview live as base salary changes', () => {
    act(() => {
      root.render(
        <OfferEditModal
          application={testApp}
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
        />,
      );
    });

    const salaryInput = container.querySelector<HTMLInputElement>('input#offer-base-salary');
    expect(salaryInput).not.toBeNull();

    act(() => {
      if (salaryInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          salaryInput,
          '250000',
        );
        salaryInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // 250_000 * 12 = 3_000_000
    const normalizedText = container.textContent?.replace(/\u00A0/g, ' ') ?? '';
    expect(normalizedText).toContain('3 000 000');
    expect(normalizedText).toContain('со слов кандидата');
  });

  it('submits updated terms on save button click', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(
        <OfferEditModal
          application={testApp}
          isOpen={true}
          onClose={() => {}}
          onSave={onSave}
        />,
      );
    });

    const salaryInput = container.querySelector<HTMLInputElement>('input#offer-base-salary');
    act(() => {
      if (salaryInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          salaryInput,
          '300000',
        );
        salaryInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-testid="save-offer-btn"]');
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn?.click();
    });

    expect(onSave).toHaveBeenCalled();
    const calledArgs = onSave.mock.calls[0];
    expect(calledArgs[0]).toBe('app-test-1');
    expect(calledArgs[1].baseSalary).toBe(300000);
  });
});
