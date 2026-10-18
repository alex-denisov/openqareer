// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeProposalKey } from '../../../shared/consultantProposalKey';
import {
  approveCareerCommand,
  getCareerCommands,
  revertCareerCommand,
} from '../coach/careerCommandApi';
import { rejectCoachProposal, type CareerCommand } from '../coach/coachApi';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';
import { useConsultantSuggestions } from './useConsultantSuggestions';

vi.mock('../coach/careerCommandApi', () => ({
  approveCareerCommand: vi.fn(),
  getCareerCommands: vi.fn(),
  revertCareerCommand: vi.fn(),
}));

vi.mock('../coach/coachApi', () => ({
  rejectCoachProposal: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PROPOSED_TEXT = 'Управляла запуском продукта для 120 000 пользователей.';
const CURRENT_TEXT = 'Работала над развитием продукта.';
const UPDATED_AT = '2026-10-17T09:00:00.000Z';
const PROPOSAL_KEY = computeProposalKey('about', PROPOSED_TEXT);

function careerCommand(
  status: CareerCommand['status'],
  profileRevisionReverted = false,
): CareerCommand {
  let execution: CareerCommand['execution'] = null;
  if (
    status === 'executing' ||
    status === 'completed_with_receipt' ||
    status === 'paused' ||
    status === 'failed' ||
    status === 'native_handoff'
  ) {
    execution = {
      status,
      updatedAt: UPDATED_AT,
      connector:
        status === 'completed_with_receipt'
          ? {
              id: 'internal',
              transport: 'internal',
              providerReference: null,
              evidenceKind: 'provider_receipt',
              evidenceObservedAt: UPDATED_AT,
            }
          : null,
      diagnosticReason: status === 'paused' ? 'requires_review' : null,
    };
  }

  return {
    commandId: 'command-about-1',
    capability: 'resume.revise',
    status,
    profileRevisionReverted,
    proposal: {
      kind: 'resume.revise',
      objective: 'Показать подтверждённый масштаб ответственности.',
      evidenceRefs: ['profile:about'],
      acceptanceCriteria: ['Сохранить подтверждённый контекст.'],
      expectedSignal: 'Более точное описание опыта.',
      measureAfter: 'После следующего просмотра профиля.',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'about',
        experienceId: null,
        memoryId: null,
        proposedText: PROPOSED_TEXT,
      },
    },
    executionTarget: {
      targetType: 'resume_block',
      section: 'about',
      currentText: CURRENT_TEXT,
      proposedText: PROPOSED_TEXT,
    },
    execution,
  };
}

function suggestion(): InlineSuggestionItem {
  return {
    id: 'suggestion-about-1',
    commandId: 'command-about-1',
    section: 'about',
    title: 'Предложение карьерного консультанта',
    rationale: 'Показать подтверждённый масштаб ответственности.',
    currentText: CURRENT_TEXT,
    proposedText: PROPOSED_TEXT,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type ActionName = 'accept' | 'dismiss' | 'revert';

describe('useConsultantSuggestions and InlineConsultantSuggestion', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useConsultantSuggestions> | undefined;
  let actions: Partial<Record<ActionName, Promise<void>>>;

  function SuggestionProbe() {
    const state = useConsultantSuggestions('candidate-1');
    current = state;
    const item = state.suggestions[0];
    if (!item) return null;

    return (
      <InlineConsultantSuggestion
        suggestion={item}
        loading={state.loading}
        onAccept={(value) => {
          const action = state.acceptSuggestion(value);
          actions.accept = action;
          return action;
        }}
        onDismiss={(value) => {
          const action = state.dismissSuggestion(value);
          actions.dismiss = action;
          return action;
        }}
        onRevert={(value) => {
          const action = state.revertSuggestion(value);
          actions.revert = action;
          return action;
        }}
      />
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement('div');
    root = createRoot(container);
    current = undefined;
    actions = {};
    vi.mocked(getCareerCommands).mockResolvedValue([careerCommand('awaiting_approval')]);
    vi.mocked(approveCareerCommand).mockResolvedValue(careerCommand('completed_with_receipt'));
    vi.mocked(revertCareerCommand).mockResolvedValue(careerCommand('completed_with_receipt'));
    vi.mocked(rejectCoachProposal).mockImplementation(async ({ proposalKey }) => ({
      ok: true,
      proposalKey,
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  async function renderProbe() {
    await act(async () => {
      root.render(<SuggestionProbe />);
    });
    await act(async () => {
      await vi.mocked(getCareerCommands).mock.results[0]?.value;
    });
  }

  function card() {
    return container.querySelector('[data-testid="consultant-suggestion-command-about-1"]');
  }

  function button(label: string) {
    return Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(label),
    );
  }

  async function clickAndWait(label: string, actionName: ActionName) {
    const target = button(label);
    if (!target) throw new Error(`Missing button: ${label}`);
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      try {
        await actions[actionName];
      } catch {
        // The rendered card reports the rejected action to the candidate.
      }
    });
  }

  it('keeps a suggestion pending when approval returns paused', async () => {
    const approval = deferred<CareerCommand>();
    vi.mocked(approveCareerCommand).mockReturnValue(approval.promise);
    await renderProbe();
    const acceptButton = button('Принять');
    if (!acceptButton) throw new Error('Missing accept button');

    act(() => {
      acceptButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(acceptButton.disabled).toBe(true);
    expect(container.textContent).not.toContain('Правка применена');

    await act(async () => {
      approval.resolve(careerCommand('paused'));
      try {
        await actions.accept;
      } catch {
        // The rendered card reports the rejected action to the candidate.
      }
    });

    expect(card()).not.toBeNull();
    expect(container.textContent).not.toContain('Правка применена');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('paused');
    expect(getCareerCommands).toHaveBeenCalledTimes(1);
  });

  it('applies the card after approval returns a receipt and refreshes the command', async () => {
    vi.mocked(getCareerCommands)
      .mockResolvedValueOnce([careerCommand('awaiting_approval')])
      .mockResolvedValueOnce([careerCommand('completed_with_receipt')]);
    vi.mocked(approveCareerCommand).mockResolvedValue(careerCommand('completed_with_receipt'));
    await renderProbe();

    await clickAndWait('Принять', 'accept');

    expect(container.textContent).toContain('Правка применена');
    expect(button('Откатить')).toBeDefined();
    expect(getCareerCommands).toHaveBeenCalledTimes(2);
    expect(approveCareerCommand).toHaveBeenCalledWith('command-about-1');
  });

  it('keeps the card and shows an alert when rejection fails', async () => {
    vi.mocked(rejectCoachProposal).mockRejectedValue(new Error('Не удалось отклонить правку.'));
    await renderProbe();

    await clickAndWait('Отклонить', 'dismiss');

    expect(card()).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Не удалось отклонить правку.',
    );
    expect(button('Отклонить')?.disabled).toBe(false);
  });

  it('keeps the card visible until the server acknowledges rejection', async () => {
    const rejection = deferred<{ ok: boolean; proposalKey: string }>();
    vi.mocked(rejectCoachProposal).mockReturnValue(rejection.promise);
    await renderProbe();
    const rejectButton = button('Отклонить');
    if (!rejectButton) throw new Error('Missing reject button');

    act(() => {
      rejectButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(card()).not.toBeNull();
    expect(rejectButton.disabled).toBe(true);

    await act(async () => {
      rejection.resolve({ ok: true, proposalKey: PROPOSAL_KEY });
      await actions.dismiss;
    });

    expect(card()).toBeNull();
  });

  it('keeps an applied suggestion applied when the server does not confirm rollback', async () => {
    vi.mocked(getCareerCommands).mockResolvedValue([careerCommand('completed_with_receipt')]);
    vi.mocked(revertCareerCommand).mockResolvedValue(
      careerCommand('completed_with_receipt', false),
    );
    await renderProbe();
    expect(container.textContent).toContain('Правка применена');

    await clickAndWait('Откатить', 'revert');

    expect(card()).not.toBeNull();
    expect(container.textContent).toContain('Правка применена');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Откат');
    expect(button('Откатить')?.disabled).toBe(false);
  });

  it('rejects accept and revert attempts without a command ID', async () => {
    await renderProbe();
    const state = current;
    const item = state?.suggestions[0];
    if (!state || !item) throw new Error('Missing suggestion');
    const withoutCommandId = { ...item, commandId: undefined };

    await expect(state.acceptSuggestion(withoutCommandId)).rejects.toThrow(
      /идентификатор команды/i,
    );
    await expect(state.revertSuggestion(withoutCommandId)).rejects.toThrow(
      /идентификатор команды/i,
    );
  });

  it('disables accept and reject controls when handlers are absent', async () => {
    await act(async () => {
      root.render(<InlineConsultantSuggestion suggestion={suggestion()} />);
    });

    expect(button('Принять')?.disabled).toBe(true);
    expect(button('Отклонить')?.disabled).toBe(true);
  });

  it('reflects a new receipt-backed applied prop', async () => {
    await act(async () => {
      root.render(<InlineConsultantSuggestion suggestion={suggestion()} />);
    });
    await act(async () => {
      root.render(<InlineConsultantSuggestion suggestion={{ ...suggestion(), applied: true }} />);
    });

    expect(container.textContent).toContain('Правка применена');
    expect(button('Принять')).toBeUndefined();
  });
});
