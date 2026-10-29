// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import type { CandidateMemory } from '../coach/coachApi';
import { ExperienceSuggestionsList } from './ProfileExperienceSection';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  experience: [
    {
      id: 'rosseti',
      chronologyMemoryId: 'rosseti-chronology',
      employer: 'Россети Цифра',
      startDate: 'Apr 2023',
      endDate: 'Oct 2025',
      current: false,
      bulletMemoryIds: ['imported-1'],
    },
    {
      id: 'fishance',
      chronologyMemoryId: 'fishance-chronology',
      employer: 'Fishance Berhad',
      startDate: 'Jul 2016',
      endDate: 'Oct 2019',
      current: false,
      bulletMemoryIds: [],
    },
  ],
};

function fact(id: string, statement: string): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain: 'outcome',
    statement,
    confidence: 'candidate-reported',
    sourceMessageIds: [`msg-${id}`],
    sensitive: false,
    status: 'confirmed',
    provenance: { kind: 'candidate', at: '2026-10-25T10:00:00.000Z' },
  };
}

const memory = [
  fact('f-rosseti', 'В Россети Цифра выручка выросла вчетверо.'),
  fact('f-fishance', 'Fishance продана с выручкой $50M+.'),
  fact('f-loose', 'Тикетов стало на 40% меньше.'),
];

function saveMock(result: boolean = true) {
  return vi.fn<(next: ResumeDraft) => boolean>(() => result);
}

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function mount(node: ReactNode): HTMLElement {
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

function render(onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void) {
  return mount(
    <ExperienceSuggestionsList
      draft={draft}
      memory={memory}
      suggestions={[]}
      onSectionSave={onSectionSave}
    />,
  );
}

function buttonIn(root: Element, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found as HTMLButtonElement;
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click();
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

function consultantBlock(container: HTMLElement): Element {
  const block = container.querySelector('.profile-experience-suggestions');
  expect(block).not.toBeNull();
  return block as Element;
}

function pendingBlock(container: HTMLElement): Element {
  const block = container.querySelector('[data-testid="pending-experience-facts"]');
  expect(block).not.toBeNull();
  return block as Element;
}

describe('conversation facts in «Опыт» (C10)', () => {
  it('offers each matched fact under its employer as a consultant proposal', () => {
    const container = render(vi.fn());
    const block = consultantBlock(container);
    expect(block.querySelector('[data-suggestion-id="fact:f-rosseti"]')?.textContent).toContain(
      'Россети Цифра',
    );
    expect(block.querySelector('[data-suggestion-id="fact:f-rosseti"] ins')?.textContent).toBe(
      'В Россети Цифра выручка выросла вчетверо.',
    );
    expect(block.querySelector('[data-suggestion-id="fact:f-fishance"]')?.textContent).toContain(
      'Fishance Berhad',
    );
  });

  it('«Принять» writes every proposed fact into its workplace with one save', async () => {
    const save = saveMock();
    const container = render(save);
    await click(buttonIn(consultantBlock(container), 'Принять'));
    expect(save).toHaveBeenCalledTimes(1);
    const next = save.mock.calls[0][0];
    expect(next.experience.find((entry) => entry.id === 'rosseti')?.bulletMemoryIds).toEqual([
      'imported-1',
      'f-rosseti',
    ]);
    expect(next.experience.find((entry) => entry.id === 'fishance')?.bulletMemoryIds).toEqual([
      'f-fishance',
    ]);
  });

  it('«Отклонить» records the declined facts and leaves the workplaces alone', async () => {
    const save = saveMock();
    const container = render(save);
    await click(buttonIn(consultantBlock(container), 'Отклонить'));
    const next = save.mock.calls[0][0];
    expect(next.declinedFactIds).toEqual(['f-rosseti', 'f-fishance']);
    expect(next.experience).toEqual(draft.experience);
  });

  it('says so when the save did not go through', async () => {
    const container = render(saveMock(false));
    await click(buttonIn(consultantBlock(container), 'Принять'));
    expect(consultantBlock(container).querySelector('[role="alert"]')?.textContent).toContain(
      'Не сохранилось',
    );
  });

  it('lists a fact no workplace was found for as waiting, with its source', () => {
    const container = render(vi.fn());
    const block = pendingBlock(container);
    expect(block.textContent).toContain('1 факт ждёт подтверждения');
    expect(block.textContent).toContain('Тикетов стало на 40% меньше.');
    expect(block.textContent).toContain('со слов кандидата');
  });

  it('adds a waiting fact to the workplace the candidate picks', async () => {
    const save = saveMock();
    const container = render(save);
    const block = pendingBlock(container);
    const add = buttonIn(block, 'Добавить');
    expect(add.disabled).toBe(true);
    const select = block.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'rosseti';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(buttonIn(block, 'Добавить'));
    const next = save.mock.calls[0][0];
    expect(next.experience.find((entry) => entry.id === 'rosseti')?.bulletMemoryIds).toEqual([
      'imported-1',
      'f-loose',
    ]);
  });

  it('declines a waiting fact on its own', async () => {
    const save = saveMock();
    const container = render(save);
    await click(buttonIn(pendingBlock(container), 'Отклонить'));
    expect(save.mock.calls[0][0].declinedFactIds).toEqual(['f-loose']);
  });
});
