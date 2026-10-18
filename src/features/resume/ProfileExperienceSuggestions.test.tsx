// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import type { ResumeDraft } from './resumeTypes';
import {
  ProfileExperienceSuggestions,
  type ProfileExperienceSuggestionsProps,
} from './ProfileExperienceSuggestions';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';

const draft: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  experience: [
    {
      id: 'experience-1',
      chronologyMemoryId: 'chronology-1',
      employer: 'Финтех Лаб',
      current: true,
      bulletMemoryIds: [],
    },
    {
      id: 'experience-2',
      chronologyMemoryId: 'chronology-2',
      employer: 'Маркет Софт',
      current: false,
      bulletMemoryIds: [],
    },
  ],
};

const disposers: Array<() => void> = [];

afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function item(
  id: string,
  experienceId: string,
  values: Partial<InlineSuggestionItem> = {},
): InlineSuggestionItem {
  return {
    id,
    section: 'experience',
    experienceId,
    currentText: 'Сейчас',
    proposedText: 'Предлагается',
    ...values,
  };
}

function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function render(
  suggestions: readonly InlineSuggestionItem[],
  options: Partial<Omit<ProfileExperienceSuggestionsProps, 'draft' | 'suggestions'>> = {},
) {
  return mount(
    <ProfileExperienceSuggestions draft={draft} suggestions={suggestions} {...options} />,
  );
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(element).toBeDefined();
  return element as HTMLButtonElement;
}

async function flushPromises() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

async function click(container: HTMLElement, label: string) {
  await act(async () => {
    button(container, label).click();
    await flushPromises();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ProfileExperienceSuggestions', () => {
  it('groups experience changes in one panel with employer labels and shared actions', () => {
    const container = render(
      [
        { ...item('about-1', 'experience-1'), section: 'about' },
        item('proposal-1', 'experience-1', {
          currentText: 'неизвестно',
          proposedText: '38 человек',
        }),
        item('proposal-2', 'experience-2', {
          currentText: '02.2021',
          proposedText: '01.2021',
        }),
      ],
      { onAcceptSuggestion: vi.fn(), onDismissSuggestion: vi.fn() },
    );

    expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(container.textContent).toContain('Финтех Лаб');
    expect(container.textContent).toContain('Маркет Софт');
    expect(container.querySelector('[data-suggestion-id="proposal-1"] del')?.textContent).toBe(
      'неизвестно',
    );
    expect(container.querySelector('[data-suggestion-id="proposal-1"] ins')?.textContent).toBe(
      '38 человек',
    );
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.textContent).toContain('Пока вы не примете, в резюме ничего не изменится.');
    expect(container.textContent).not.toContain('Предлагается консультантом');
  });

  it('does not infer a missing employer or parse proposal text into fields', () => {
    const container = render([
      item('unknown-employer', 'missing-experience', {
        title: 'Финтех Лаб',
        currentText: 'неизвестно',
        proposedText: '38 человек',
      }),
    ]);
    const row = container.querySelector('[data-suggestion-id="unknown-employer"]');

    expect(row?.textContent).toContain('Компания не указана');
    expect(row?.querySelector('del')?.textContent).toBe('неизвестно');
    expect(row?.querySelector('ins')?.textContent).toBe('38 человек');
    expect(row?.textContent).not.toContain('Финтех Лаб');
    expect(row?.textContent).not.toContain('Размер команды');
  });

  it('awaits every acceptance in sequence and keeps the panel busy until completion', async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const onAcceptSuggestion = vi.fn(async (suggestion: InlineSuggestionItem) => {
      calls.push(suggestion.id);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await (suggestion.id === 'first' ? firstGate.promise : secondGate.promise);
      active -= 1;
    });
    const container = render([item('first', 'experience-1'), item('second', 'experience-2')], {
      onAcceptSuggestion,
      onDismissSuggestion: vi.fn(),
    });

    await act(async () => {
      button(container, 'Принять').click();
      await flushPromises();
    });
    expect(calls).toEqual(['first']);
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-busy')).toBe('true');
    expect(button(container, 'Применяем…').disabled).toBe(true);
    expect(button(container, 'Отклонить').disabled).toBe(true);

    await act(async () => {
      firstGate.resolve();
      await firstGate.promise;
      await flushPromises();
    });
    expect(calls).toEqual(['first', 'second']);
    expect(maximumActive).toBe(1);

    await act(async () => {
      secondGate.resolve();
      await secondGate.promise;
      await flushPromises();
    });
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-busy')).toBeNull();
  });

  it('shows refreshed applied state after a partial acceptance and retries only the pending row', async () => {
    const initial = [item('first', 'experience-1'), item('second', 'experience-2')];
    const calls: string[] = [];
    let failSecond = true;
    function Harness() {
      const [suggestions, setSuggestions] = useState(initial);
      const onAcceptSuggestion = async (suggestion: InlineSuggestionItem) => {
        calls.push(suggestion.id);
        if (suggestion.id === 'second' && failSecond) {
          failSecond = false;
          throw new Error('Временная ошибка');
        }
        setSuggestions((current) =>
          current.map((entry) =>
            entry.id === suggestion.id ? { ...entry, applied: true } : entry,
          ),
        );
      };
      return (
        <ProfileExperienceSuggestions
          draft={draft}
          suggestions={suggestions}
          onAcceptSuggestion={onAcceptSuggestion}
          onDismissSuggestion={vi.fn()}
        />
      );
    }
    const container = mount(<Harness />);

    await click(container, 'Принять');
    expect(calls).toEqual(['first', 'second']);
    expect(
      container.querySelector('[data-suggestion-id="first"] [role="status"]')?.textContent,
    ).toBe('Правка применена');
    expect(container.querySelector('[data-suggestion-id="second"] [role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Временная ошибка');
    expect(container.textContent).toContain('Непринятые правки не изменят резюме');

    await click(container, 'Принять');
    expect(calls).toEqual(['first', 'second', 'second']);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps a dismissal visible while waiting for server acknowledgement', async () => {
    const gate = deferred<void>();
    const suggestion = item('pending-dismissal', 'experience-1');
    function Harness() {
      const [suggestions, setSuggestions] = useState([suggestion]);
      const onDismissSuggestion = async (current: InlineSuggestionItem) => {
        await gate.promise;
        setSuggestions((items) => items.filter((entry) => entry.id !== current.id));
      };
      return (
        <ProfileExperienceSuggestions
          draft={draft}
          suggestions={suggestions}
          onDismissSuggestion={onDismissSuggestion}
        />
      );
    }
    const container = mount(<Harness />);

    await act(async () => {
      button(container, 'Отклонить').click();
      await flushPromises();
    });
    expect(container.querySelector('[data-suggestion-id="pending-dismissal"]')).not.toBeNull();
    expect(button(container, 'Отклоняем…').disabled).toBe(true);

    await act(async () => {
      gate.resolve();
      await gate.promise;
      await flushPromises();
    });
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('retries only the unacknowledged dismissal after a partial rejection failure', async () => {
    const initial = [
      item('first-dismissal', 'experience-1'),
      item('second-dismissal', 'experience-2'),
    ];
    const calls: string[] = [];
    let failSecond = true;
    function Harness() {
      const [suggestions, setSuggestions] = useState(initial);
      const onDismissSuggestion = async (suggestion: InlineSuggestionItem) => {
        calls.push(suggestion.id);
        if (suggestion.id === 'second-dismissal' && failSecond) {
          failSecond = false;
          throw new Error('Отклонение не подтверждено');
        }
        setSuggestions((current) => current.filter((entry) => entry.id !== suggestion.id));
      };
      return (
        <ProfileExperienceSuggestions
          draft={draft}
          suggestions={suggestions}
          onDismissSuggestion={onDismissSuggestion}
        />
      );
    }
    const container = mount(<Harness />);

    await click(container, 'Отклонить');
    expect(calls).toEqual(['first-dismissal', 'second-dismissal']);
    expect(container.querySelector('[data-suggestion-id="first-dismissal"]')).toBeNull();
    expect(container.querySelector('[data-suggestion-id="second-dismissal"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Отклонение не подтверждено',
    );

    await click(container, 'Отклонить');
    expect(calls).toEqual(['first-dismissal', 'second-dismissal', 'second-dismissal']);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('disables shared actions when the corresponding handlers are unavailable', () => {
    const container = render([item('pending', 'experience-1')]);

    expect(button(container, 'Принять').disabled).toBe(true);
    expect(button(container, 'Отклонить').disabled).toBe(true);
  });

  it('shows receipt-backed applied state and a per-row revert without a group revert', async () => {
    const applied = item('already-applied', 'experience-1', { applied: true });
    const pending = item('still-pending', 'experience-2');
    const onRevertSuggestion = vi.fn().mockResolvedValue(undefined);
    const container = render([applied, pending], {
      onAcceptSuggestion: vi.fn(),
      onDismissSuggestion: vi.fn(),
      onRevertSuggestion,
    });

    const appliedRow = container.querySelector('[data-suggestion-id="already-applied"]');
    expect(appliedRow?.querySelector('[role="status"]')?.textContent).toBe('Правка применена');
    expect(appliedRow?.querySelectorAll('button')).toHaveLength(1);
    expect(container.textContent).not.toContain('Откатить все');
    expect(container.querySelectorAll('button')).toHaveLength(3);

    await click(container, 'Откатить');
    expect(onRevertSuggestion).toHaveBeenCalledExactlyOnceWith(applied);
    expect(appliedRow?.querySelector('[role="status"]')?.textContent).toBe('Правка применена');
  });

  it('keeps applied state and announces a failed row revert', async () => {
    const applied = item('applied-revert-fails', 'experience-1', { applied: true });
    const container = render([applied], {
      onRevertSuggestion: vi.fn().mockRejectedValue(new Error('Откат не подтверждён')),
    });

    await click(container, 'Откатить');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Откат не подтверждён');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Правка применена');
  });
});
