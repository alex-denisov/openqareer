// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { SelectedResponsePanel } from './SelectedResponsePanel';

vi.mock('./applicationContactApi', () => ({
  getApplicationContact: vi.fn(() => new Promise(() => undefined)),
  saveApplicationContact: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'Vice President of Operations', company: 'Firstrade', url: 'https://x', source: 'indeed' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-11-10T10:00:00.000Z',
    version: 1,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  } as ApplicationView;
}

let root: Root | undefined;
let host: HTMLElement | undefined;

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => created.render(node));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

const base = {
  onMarkFollowUpSent: vi.fn().mockResolvedValue(undefined),
  onChangeStage: vi.fn(),
  onScheduleInterview: vi.fn(),
  onRefresh: vi.fn(),
  onSaveNote: vi.fn(),
  onSkip: vi.fn(),
};

const attachButtons = () =>
  Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Прикрепить');

describe('SelectedResponsePanel materials (B631)', () => {
  it('turns «не привязано» into «Прикрепить», which prepares the letter for this response', () => {
    const onAttachMaterials = vi.fn();
    const app = application();
    mount(<SelectedResponsePanel {...base} application={app} onAttachMaterials={onAttachMaterials} />);
    const buttons = attachButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Прикрепить резюме',
      'Прикрепить письмо',
    ]);
    act(() => buttons[1]?.click());
    expect(onAttachMaterials).toHaveBeenCalledWith(app);
  });

  it('offers nothing to attach when both are linked or the card has no vacancy', () => {
    mount(
      <SelectedResponsePanel
        {...base}
        application={application({ materials: { coverLetter: true, resume: true } })}
        onAttachMaterials={vi.fn()}
      />,
    );
    expect(attachButtons()).toHaveLength(0);
    act(() => root?.unmount());
    host?.remove();
    mount(
      <SelectedResponsePanel
        {...base}
        application={application({ clusterId: null })}
        onAttachMaterials={vi.fn()}
      />,
    );
    expect(attachButtons()).toHaveLength(0);
    expect(document.body.textContent).toContain('Письмо не привязано');
  });
});
