// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { SkillQuizApplyResultCard } from './SkillQuizApplyResultCard';
import type { SkillQuizApplyResponse } from '../coach/careerCommandApi';

const api = vi.hoisted(() => ({ revertCareerCommand: vi.fn() }));
vi.mock('../coach/careerCommandApi', () => api);

const roots: Root[] = [];
const appliedResult: SkillQuizApplyResponse = {
  commandId: 'command-1',
  command: {} as never,
  result: {
    quizId: 'typescript',
    scorePercent: 100,
    correctAnswersCount: 4,
    totalQuestions: 4,
    passed: true,
    status: 'подтверждён',
    statusLabel: 'подтверждён',
    source: 'hh.ru',
    verifiedAt: '2026-10-06',
    verifiedBadgeAwarded: false,
    review: [],
  },
  fact: {
    skillName: 'TypeScript',
    status: 'подтверждён',
    source: 'hh.ru',
    date: '2026-10-06',
    scorePercent: 100,
    statement: 'TypeScript: подтверждён (hh.ru, 2026-10-06, 100%)',
  },
};

async function mountCard() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <SkillQuizApplyResultCard
      {...appliedResult}
    />,
  ));
  return container;
}

async function clickUndo(container: HTMLElement) {
  const button = container.querySelector('button');
  if (!button) throw new Error('Undo button is missing');
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe('skill quiz applied result card', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.revertCareerCommand.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
  });

  it('shows the applied skill and replaces Undo with confirmation after revert', async () => {
    api.revertCareerCommand.mockResolvedValue({ commandId: 'command-1' });
    const container = await mountCard();

    expect(container.textContent).toContain('Навык обновлён: TypeScript');
    expect(container.querySelector('button')?.textContent).toBe('Откатить');
    await clickUndo(container);

    expect(api.revertCareerCommand).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Изменение отменено.');
    expect(container.querySelector('button')).toBeNull();
  });

  it('maps a repeated revert conflict to the expected message and hides Undo', async () => {
    api.revertCareerCommand.mockRejectedValue(
      new CoachApiError('already reverted', 'profile_revision_already_reverted', false),
    );
    const container = await mountCard();
    await clickUndo(container);

    expect(container.textContent).toContain('Это изменение уже отменено');
    expect(container.querySelector('button')).toBeNull();
  });

  it('maps a missing result to a useful message without crashing', async () => {
    api.revertCareerCommand.mockRejectedValue(
      new CoachApiError('not found', 'career_command_not_found', false),
    );
    const container = await mountCard();
    await clickUndo(container);

    expect(container.textContent).toContain('Результат не найден, обновите страницу');
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps Undo available and retryable after a network failure', async () => {
    api.revertCareerCommand
      .mockRejectedValueOnce(new CoachApiError('network failure', 'network_error', true))
      .mockResolvedValueOnce({ commandId: 'command-1' });
    const container = await mountCard();

    await clickUndo(container);
    expect(container.textContent).toContain('Не удалось отменить результат. Попробуйте ещё раз.');
    expect(container.querySelector('button')?.textContent).toBe('Откатить');

    await clickUndo(container);
    expect(api.revertCareerCommand).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Изменение отменено.');
  });

  it('does not send a second revert while the first request is pending', async () => {
    let finish!: (command: { commandId: string }) => void;
    api.revertCareerCommand.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const container = await mountCard();
    const button = container.querySelector('button')!;

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(button.disabled).toBe(true);
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.revertCareerCommand).toHaveBeenCalledTimes(1);

    await act(async () => finish({ commandId: 'command-1' }));
    expect(container.textContent).toContain('Изменение отменено.');
  });
});
