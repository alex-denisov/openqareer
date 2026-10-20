// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const addFact = vi.hoisted(() => vi.fn());
vi.mock('./experienceFactApi', () => ({ addManualExperienceFact: addFact }));
import { ProfileMobilePositionEditor } from './ProfileMobilePositionEditor';
import type { ResumeExperienceInput } from './resumeTypes';
import type { CandidateMemory } from '../coach/coachApi';

const entry: ResumeExperienceInput = {
  id: 'role-1',
  chronologyMemoryId: 'role-memory',
  title: 'Инженер',
  employer: 'Компания',
  startDate: '2020-01',
  current: true,
  skills: ['TypeScript'],
  descriptionMemoryId: 'description',
  bulletMemoryIds: [],
};
const memory: CandidateMemory[] = [
  {
    id: 'description',
    kind: 'fact',
    domain: 'responsibility',
    statement: 'Руководил разработкой.',
    confidence: 'candidate-reported',
    status: 'confirmed',
    sourceMessageIds: ['source-message'],
    sensitive: false,
  },
];
const cleanup: Array<() => void> = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

function render(saved = true) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const save = vi
    .fn<(patch: Partial<ResumeExperienceInput>) => Promise<boolean>>()
    .mockResolvedValue(saved);
  const done = vi.fn();
  act(() =>
    root.render(
      <ProfileMobilePositionEditor
        entry={entry}
        memory={memory}
        candidateId="candidate-test"
        onSave={save}
        onDone={done}
        onCancel={vi.fn()}
      />,
    ),
  );
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, save, done };
}

function input(container: HTMLElement, selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector)!;
  expect(field).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}

describe('mobile position form', () => {
  it('saves a displayed month and added skill while preserving the existing description link', async () => {
    const { container, save, done } = render();
    expect(container.querySelector<HTMLInputElement>('[name="startDate"]')?.value).toBe('01.2020');
    expect(container.querySelector('textarea')?.value).toBe('Руководил разработкой.');
    act(() => container.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
    input(container, '[name="endDate"]', '12.2022');
    act(() => container.querySelector<HTMLButtonElement>('.pm-chips button')!.click());
    input(container, '[aria-label="Навык на этом месте"]', ' Rust ');
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        endDate: '2022-12',
        current: false,
        skills: ['TypeScript', 'Rust'],
        descriptionMemoryId: 'description',
      }),
    );
    expect(addFact).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledOnce();
  });

  it('retains edited fields and reports a rejected save instead of closing', async () => {
    const { container, save, done } = render(false);
    input(container, 'input', 'Новая должность');
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector('input')?.value).toBe('Новая должность');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
  });

  it('blocks invalid month input through native form validity', () => {
    const { container, save } = render();
    const month = input(container, '[name="startDate"]', '14.2020');
    expect(month.validity.patternMismatch).toBe(true);
    act(() => container.querySelector('form')!.requestSubmit());
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the team size in people with the place (B540)', async () => {
    const { container, save } = render();
    const field = input(container, '[name="teamSize"]', '38');
    expect(field.closest('label')?.textContent).toContain('Размер команды');
    expect(field.closest('label')?.textContent).toContain('человек');
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ teamSize: 38 }));
  });
});
