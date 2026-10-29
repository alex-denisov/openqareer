// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillConfirmDialog } from './SkillConfirmDialog';
import type { SkillConfirmation } from './skillConfirmationApi';
import * as api from './skillConfirmationApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

type Props = Parameters<typeof SkillConfirmDialog>[0];

function mount(props: Partial<Props> & Pick<Props, 'skills'>) {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    createRoot(root).render(
      <SkillConfirmDialog onClose={vi.fn()} onApplied={vi.fn()} {...props} />,
    );
  });
  return root;
}

function button(root: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);
}

async function click(root: HTMLElement, name: string) {
  await act(async () => {
    button(root, name)?.click();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function skill(overrides: Partial<SkillConfirmation> = {}): SkillConfirmation {
  return {
    id: 's1',
    name: 'SQL',
    status: null,
    source: null,
    verifiedAt: null,
    quizCheckable: true,
    attemptsLeftToday: 2,
    lastAttempt: null,
    conversation: { name: 'SQL', state: 'not_checked', facts: [] },
    ...overrides,
  };
}

const quiz: api.GeneratedSkillQuiz = {
  attemptId: 'a1',
  skillName: 'SQL',
  level: 'middle',
  passingScorePercent: 80,
  questions: [{ id: 'q1', question: 'Что делает JOIN?', options: ['А', 'Б', 'В', 'Г'] }],
};

describe('SkillConfirmDialog', () => {
  it('does not offer the test for a skill the quiz cannot check', () => {
    const root = mount({ skills: [skill({ quizCheckable: false })], onDiscuss: vi.fn() });
    expect(button(root, 'Пройти тест')).toBeUndefined();
    expect(root.textContent).toContain('тестом не проверить');
    expect(button(root, 'Разобрать в беседе')).toBeDefined();
  });

  it('says so when the daily attempts are used', () => {
    const root = mount({ skills: [skill({ attemptsLeftToday: 0 })] });
    expect(root.textContent).toContain('Две попытки за сутки использованы.');
    expect(button(root, 'Пройти тест')).toBeUndefined();
  });

  it('shows the discussed fact with its date', () => {
    const root = mount({
      skills: [
        skill({
          conversation: {
            name: 'SQL',
            state: 'discussed',
            facts: [
              {
                memoryId: 'm1',
                statement: 'Оптимизировал 40 запросов',
                sourceMessageIds: ['x'],
                at: '2026-10-25T09:00:00Z',
              },
            ],
          },
        }),
      ],
    });
    expect(root.textContent).toContain('Разобрано в беседе');
    expect(root.textContent).toMatch(/Оптимизировал 40 запросов · 25\.10/);
  });

  it('keeps the review hidden until the answers are submitted, then applies', async () => {
    vi.spyOn(api, 'generateSkillQuiz').mockResolvedValue(quiz);
    vi.spyOn(api, 'submitSkillQuiz').mockResolvedValue({
      attemptId: 'a1',
      skillName: 'SQL',
      result: {
        scorePercent: 100,
        correctAnswersCount: 1,
        totalQuestions: 1,
        passed: true,
        status: 'подтверждён',
        source: 'openqareer',
        verifiedAt: '2026-10-29',
        review: [
          {
            questionId: 'q1',
            question: 'Что делает JOIN?',
            selectedOptionIndex: 1,
            correctOptionIndex: 1,
            isCorrect: true,
            explanation: 'Объединяет таблицы',
          },
        ],
      },
    });
    const apply = vi.spyOn(api, 'applySkillQuizAttempt').mockResolvedValue({ commandId: 'c1' });
    const onApplied = vi.fn();
    const root = mount({ skills: [skill()], onApplied });

    await click(root, 'Пройти тест');
    await click(root, 'Средний');
    await flush();
    expect(root.textContent).toContain('Что делает JOIN?');
    expect(root.textContent).not.toContain('Объединяет таблицы');
    expect(button(root, 'Сдать')?.disabled).toBe(true);

    await act(async () => {
      root.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();
    });
    await click(root, 'Сдать');
    await flush();
    expect(root.textContent).toContain('Объединяет таблицы');

    await click(root, 'Принять результат');
    await flush();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'a1' }));
  });

  it('shows a human error when the questions cannot be built', async () => {
    vi.spyOn(api, 'generateSkillQuiz').mockRejectedValue(new Error('RAW'));
    const root = mount({ skills: [skill()] });
    await click(root, 'Пройти тест');
    await click(root, 'Начальный');
    await flush();
    const alert = root.querySelector('[role=alert]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toContain('RAW');
  });
});
