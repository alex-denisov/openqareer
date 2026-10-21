// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const addManualExperienceFactMock = vi.hoisted(() => vi.fn());
vi.mock('./experienceFactApi', () => ({
  addManualExperienceFact: addManualExperienceFactMock,
}));
import {
  PositionEditForm,
  usePositionFormState,
  usePositionSubmit,
} from './ProfileExperienceEditor';
import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeExperienceInput } from './resumeTypes';

const entry: ResumeExperienceInput = {
  id: 'manual-work',
  chronologyMemoryId: 'manual-chronology',
  title: 'Разработчик',
  employer: 'Тестовая компания',
  startDate: '2020-01',
  current: true,
  bulletMemoryIds: [],
};
const dispose: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  addManualExperienceFactMock.mockResolvedValue(candidateMemory('new-fact', 'New fact.'));
});
afterEach(() => {
  dispose.splice(0).forEach((cleanup) => cleanup());
});

function renderEditor(
  options: {
    readonly entry?: ResumeExperienceInput;
    readonly memory?: readonly CandidateMemory[];
    readonly candidateId?: string;
    readonly onSave?: (
      patch: Partial<ResumeExperienceInput>,
    ) => Promise<boolean | void> | boolean | void;
    readonly onDone?: () => void;
    readonly onManualExperienceFactAdded?: () => Promise<void> | void;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSave = vi.fn(options.onSave ?? (() => Promise.resolve(true)));
  const onDone = vi.fn(options.onDone);
  const onManualExperienceFactAdded = vi.fn(options.onManualExperienceFactAdded);
  const props = {
    entry: options.entry ?? entry,
    memory: options.memory ?? [],
    candidateId: options.candidateId ?? 'candidate-1',
    onSave,
    onDone,
    onManualExperienceFactAdded,
    onCancel: () => undefined,
  };
  act(() => root.render(<PositionEditForm {...props} />));
  dispose.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  const rerenderEntry = (next: ResumeExperienceInput) =>
    act(() => root.render(<PositionEditForm {...props} entry={next} />));
  return { container, onSave, onDone, onManualExperienceFactAdded, rerenderEntry };
}

function candidateMemory(id: string, statement: string): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain: 'responsibility',
    statement,
    confidence: 'candidate-confirmed',
    sourceMessageIds: [`source-${id}`],
    sensitive: false,
    status: 'confirmed',
  };
}

function getTextarea(container: HTMLElement, labelText: string): HTMLTextAreaElement {
  const label = [...container.querySelectorAll('label')].find((item) =>
    item.textContent?.includes(labelText),
  );
  const textarea = label?.querySelector('textarea');
  if (!textarea) throw new Error(`Missing textarea for ${labelText}`);
  return textarea;
}

function changeTextarea(container: HTMLElement, labelText: string, value: string): void {
  const textarea = getTextarea(container, labelText);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  act(() => textarea.dispatchEvent(new Event('input', { bubbles: true })));
}

function getInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const byAria = container.querySelector<HTMLInputElement>(`input[aria-label="${labelText}"]`);
  const linked = [...container.querySelectorAll('label')].find(
    (label) => label.textContent?.trim() === labelText,
  )?.control;
  const input = byAria ?? (linked instanceof HTMLInputElement ? linked : undefined);
  if (!input) throw new Error(`Missing input for ${labelText}`);
  return input;
}

function changeInput(container: HTMLElement, labelText: string, value: string): void {
  const input = getInput(container, labelText);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

async function submitForm(container: HTMLElement): Promise<void> {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function renderSkillsHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSave = vi.fn().mockResolvedValue(true);
  const props = {
    entry,
    memory: [],
    candidateId: 'candidate-1',
    onSave,
    onDone: () => undefined,
    onCancel: () => undefined,
  };
  function Harness() {
    const form = usePositionFormState(entry, []);
    const submit = usePositionSubmit(props, form);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit.save();
        }}
      >
        <button
          type="button"
          onClick={() => form.setSkills([' Go ', '', 'python', 'go', ' TypeScript '])}
        >
          Set skills
        </button>
        <button type="submit">Save</button>
      </form>
    );
  }
  act(() => root.render(<Harness />));
  dispose.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, onSave };
}

describe('desktop position editor layout and controls', () => {
  it('orders identity, dates, workplace and full-width description with a truthful local draft header', () => {
    const { container } = renderEditor({
      entry: { ...entry, employer: 'Маркет Софт', current: false },
    });
    const editor = container.querySelector('.profile-position-editor');
    const heading = editor?.querySelector('h3');
    const pairs = [...(editor?.querySelectorAll('.profile-position-editor__field-pair') ?? [])];

    expect(heading?.textContent).toBe('Маркет Софт: редактирование места');
    expect(editor?.textContent).toContain('Черновик правок');
    expect(editor?.textContent).not.toContain('hh.ru');
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.textContent).toContain('Должность');
    expect(pairs[0]?.textContent).toContain('Компания');
    expect(pairs[1]?.textContent).toContain('Начало');
    expect(pairs[1]?.textContent).toContain('Окончание');
    expect(pairs[2]?.textContent).toContain('Локация');
    expect(pairs[2]?.textContent).toContain('Формат работы');
    expect(editor?.querySelector('.profile-position-editor__description textarea')).not.toBeNull();
  });

  it('keeps the current-role checkbox available for a historical role and disables its end date when selected', async () => {
    const { container, onSave } = renderEditor({
      entry: { ...entry, current: false, endDate: '2021-02' },
    });
    const checkbox = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.closest('label')?.textContent?.includes('Работаю здесь'));
    const endDate = container.querySelector<HTMLInputElement>('[name="endDate"]');

    expect(checkbox?.checked).toBe(false);
    expect(endDate?.disabled).toBe(false);
    act(() => checkbox?.click());
    expect(checkbox?.checked).toBe(true);
    expect(endDate?.disabled).toBe(true);

    await submitForm(container);
    expect(onSave.mock.calls[0]?.[0].current).toBe(true);
    expect(onSave.mock.calls[0]?.[0].endDate).toBeUndefined();
  });

  it('adds and removes editable achievement rows while saving only remaining entered facts', async () => {
    const { container, onSave } = renderEditor();
    changeInput(container, 'Достижение 1', 'Увеличил надёжность сервиса.');
    const add = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Достижение',
    );
    act(() => add?.click());
    changeInput(container, 'Достижение 2', 'Сократил время выпуска.');

    const removeFirst = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Убрать достижение 1"]',
    );
    act(() => removeFirst?.click());
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Достижение 1"]')?.value,
    ).toBe('Сократил время выпуска.');

    await submitForm(container);
    expect(addManualExperienceFactMock).toHaveBeenCalledOnce();
    expect(addManualExperienceFactMock.mock.calls[0]?.[0].statement).toBe(
      'Сократил время выпуска.',
    );
    expect(onSave.mock.calls[1]?.[0].bulletMemoryIds).toEqual(['new-fact']);
  });
});

describe('experience workplace facts', () => {
  it('does not turn an unknown workplace format into an office fact on save', async () => {
    const { container, onSave } = renderEditor();
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].workplaceType).toBeUndefined();
  });

  it('saves only the workplace format selected by the candidate', async () => {
    const { container, onSave } = renderEditor();
    const remote = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Удалённо',
    );
    expect(remote).toBeDefined();
    act(() => remote!.click());
    expect(remote!.getAttribute('aria-pressed')).toBe('true');
    await submitForm(container);
    expect(onSave.mock.calls[0][0].workplaceType).toBe('remote');
  });
});

describe('experience description contract', () => {
  it('merges an externally accepted date without losing another edit or original day precision', async () => {
    const original = { ...entry, current: false, startDate: '2020-01-04', endDate: '2021-02-05' };
    const { container, onSave, rerenderEntry } = renderEditor({ entry: original });
    changeInput(container, 'Должность', 'Обновлённая должность');
    rerenderEntry({ ...original, endDate: '2021-03-06' });
    expect(getInput(container, 'Окончание').value).toBe('2021-03');
    await submitForm(container);
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        title: 'Обновлённая должность',
        startDate: '2020-01-04',
        endDate: '2021-03-06',
      }),
    );
  });

  it('retains conflicting date input and blocks overwriting a newer accepted date', async () => {
    const original = { ...entry, current: false, endDate: '2021-02-05' };
    const { container, onSave, onDone, rerenderEntry } = renderEditor({ entry: original });
    changeInput(container, 'Окончание', '2021-03');
    rerenderEntry({ ...original, endDate: '2021-02-06' });
    await submitForm(container);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Дата уже изменена');
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="month"]')].at(-1)?.value,
    ).toBe('2021-03');
  });
  it('relinks an edited achievement to new evidence and preserves the original source', async () => {
    const original = candidateMemory('achievement-original', 'Original outcome.');
    const replacement = candidateMemory('achievement-replacement', 'Updated outcome with 4 teams.');
    addManualExperienceFactMock.mockResolvedValue(replacement);
    const { container, onSave } = renderEditor({
      entry: { ...entry, bulletMemoryIds: [original.id] },
      memory: [original],
    });
    changeInput(container, `Достижение: ${original.statement}`, replacement.statement);
    await submitForm(container);
    expect(original.statement).toBe('Original outcome.');
    expect(addManualExperienceFactMock).toHaveBeenCalledWith(
      expect.objectContaining({ statement: replacement.statement, experienceId: entry.id }),
    );
    expect(onSave.mock.calls[0]?.[0].bulletMemoryIds).toEqual([original.id]);
    expect(onSave.mock.calls[1]?.[0].bulletMemoryIds).toEqual([replacement.id]);
  });

  it('keeps an edited achievement and its retry key after a failed relink', async () => {
    const original = candidateMemory('achievement-original', 'Original outcome.');
    const replacement = candidateMemory('achievement-replacement', 'Updated outcome.');
    addManualExperienceFactMock.mockResolvedValue(replacement);
    const save = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { container, onSave, onDone } = renderEditor({
      entry: { ...entry, bulletMemoryIds: [original.id] },
      memory: [original],
      onSave: save,
    });
    changeInput(container, `Достижение: ${original.statement}`, replacement.statement);
    await submitForm(container);
    const firstKey = addManualExperienceFactMock.mock.calls[0]?.[0].idempotencyKey;
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label^="Достижение:"]')?.value,
    ).toBe(replacement.statement);
    await submitForm(container);
    expect(addManualExperienceFactMock.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
    expect(onSave.mock.calls.at(-1)?.[0].bulletMemoryIds).toEqual([replacement.id]);
    expect(onDone).toHaveBeenCalledOnce();
  });
  it('loads only the linked description and keeps it out of achievement choices', async () => {
    const description = candidateMemory('description-memory', 'The role description.');
    const achievement = candidateMemory('achievement-memory', 'A confirmed outcome.');
    const unlinked = candidateMemory('unlinked-memory', 'An unlinked role fact.');
    const { container, onSave } = renderEditor({
      entry: {
        ...entry,
        descriptionMemoryId: description.id,
        bulletMemoryIds: [description.id, achievement.id],
      },
      memory: [description, achievement, unlinked],
    });

    expect(getTextarea(container, 'Описание').value).toBe(description.statement);
    const achievements = [...container.querySelectorAll('fieldset')].find(
      (fieldset) => fieldset.querySelector('legend')?.textContent === 'Достижения',
    );
    expect(
      achievements?.querySelector<HTMLInputElement>('input[aria-label^="Достижение:"]')?.value,
    ).toBe(achievement.statement);
    expect(achievements?.textContent).not.toContain(description.statement);
    expect(achievements?.textContent).not.toContain(unlinked.statement);

    await submitForm(container);
    expect(onSave.mock.calls[0]?.[0].bulletMemoryIds).toEqual([achievement.id]);
  });

  it('does not infer a description from older unlinked experience facts', async () => {
    const legacyFact = candidateMemory('legacy-memory', 'Older linked achievement.');
    const { container, onSave } = renderEditor({
      entry: { ...entry, bulletMemoryIds: [legacyFact.id] },
      memory: [legacyFact],
    });

    expect(getTextarea(container, 'Описание').value).toBe('');
    await submitForm(container);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0].bulletMemoryIds).toEqual([legacyFact.id]);
  });

  it('replaces a changed description association after creating its evidence', async () => {
    const original = candidateMemory('description-old', 'Old description.');
    const achievement = candidateMemory('achievement-old', 'Old achievement.');
    const replacement = candidateMemory('description-new', 'New description.');
    const newAchievement = candidateMemory('achievement-new', 'A newly typed result.');
    addManualExperienceFactMock
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(newAchievement);
    const { container, onSave, onManualExperienceFactAdded } = renderEditor({
      entry: {
        ...entry,
        descriptionMemoryId: original.id,
        bulletMemoryIds: [original.id, achievement.id],
      },
      memory: [original, achievement],
    });
    changeTextarea(container, 'Описание', replacement.statement);
    changeInput(container, 'Достижение 1', newAchievement.statement);

    await submitForm(container);

    expect(addManualExperienceFactMock).toHaveBeenCalledTimes(2);
    expect(addManualExperienceFactMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ statement: replacement.statement, experienceId: entry.id }),
    );
    expect(addManualExperienceFactMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ statement: newAchievement.statement, experienceId: entry.id }),
    );
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0]?.[0].descriptionMemoryId).toBe(original.id);
    expect(onSave.mock.calls[1]?.[0].descriptionMemoryId).toBe(replacement.id);
    expect(onSave.mock.calls[1]?.[0].bulletMemoryIds).toEqual([achievement.id, newAchievement.id]);
    expect(onManualExperienceFactAdded).toHaveBeenCalledOnce();
  });

  it('does not create a duplicate fact when the linked description is unchanged', async () => {
    const original = candidateMemory('description-old', 'Existing description.');
    const { container, onSave } = renderEditor({
      entry: { ...entry, descriptionMemoryId: original.id },
      memory: [original],
    });

    await submitForm(container);

    expect(addManualExperienceFactMock).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0].descriptionMemoryId).toBe(original.id);
  });

  it('removes an old description link only after the cleared value is saved', async () => {
    const original = candidateMemory('description-old', 'Existing description.');
    const { container, onSave } = renderEditor({
      entry: { ...entry, descriptionMemoryId: original.id },
      memory: [original],
    });
    changeTextarea(container, 'Описание', '');

    await submitForm(container);

    expect(addManualExperienceFactMock).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0]?.[0].descriptionMemoryId).toBe(original.id);
    expect(onSave.mock.calls[1]?.[0].descriptionMemoryId).toBeUndefined();
  });

  it('shows an alert and retains input when the first save phase returns false', async () => {
    const original = candidateMemory('description-old', 'Existing description.');
    const replacement = 'New description.';
    const save = vi.fn().mockResolvedValue(false);
    const { container, onSave } = renderEditor({
      entry: { ...entry, descriptionMemoryId: original.id },
      memory: [original],
      onSave: save,
    });
    changeTextarea(container, 'Описание', replacement);

    await submitForm(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не сохранилось',
    );
    expect(getTextarea(container, 'Описание').value).toBe(replacement);
    expect(onSave).toHaveBeenCalledOnce();
    expect(addManualExperienceFactMock).not.toHaveBeenCalled();
  });

  it('shows an alert and keeps the old description link when relinking returns false', async () => {
    const original = candidateMemory('description-old', 'Existing description.');
    const replacement = candidateMemory('description-new', 'New description.');
    addManualExperienceFactMock.mockResolvedValue(replacement);
    const save = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { container, onSave, onDone, onManualExperienceFactAdded } = renderEditor({
      entry: { ...entry, descriptionMemoryId: original.id },
      memory: [original],
      onSave: save,
    });
    changeTextarea(container, 'Описание', replacement.statement);

    await submitForm(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не сохранилось',
    );
    expect(getTextarea(container, 'Описание').value).toBe(replacement.statement);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0]?.[0].descriptionMemoryId).toBe(original.id);
    expect(onSave.mock.calls[1]?.[0].descriptionMemoryId).toBe(replacement.id);
    expect(onDone).not.toHaveBeenCalled();
    expect(onManualExperienceFactAdded).not.toHaveBeenCalled();
  });

  it('retains changed text after a fact API failure and reuses the retry key', async () => {
    const original = candidateMemory('description-old', 'Existing description.');
    const replacement = candidateMemory('description-new', 'New description.');
    addManualExperienceFactMock.mockRejectedValueOnce(new Error('network unavailable'));
    const { container, onSave, onDone } = renderEditor({
      entry: { ...entry, descriptionMemoryId: original.id },
      memory: [original],
    });
    changeTextarea(container, 'Описание', replacement.statement);

    await submitForm(container);
    const firstKey = addManualExperienceFactMock.mock.calls[0]?.[0].idempotencyKey;
    expect(getTextarea(container, 'Описание').value).toBe(replacement.statement);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();

    addManualExperienceFactMock.mockResolvedValueOnce(replacement);
    await submitForm(container);

    expect(addManualExperienceFactMock).toHaveBeenCalledTimes(2);
    expect(addManualExperienceFactMock.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('trims blank skills and deduplicates them case-insensitively before saving', async () => {
    const { container, onSave } = renderSkillsHarness();
    const set = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Set skills',
    );
    act(() => set!.click());
    await submitForm(container);

    expect(onSave.mock.calls[0]?.[0].skills).toEqual(['Go', 'python', 'TypeScript']);
  });
});

describe('PositionEditForm team size (B540)', () => {
  function changeTeamSize(container: HTMLElement, value: string) {
    const input = container.querySelector<HTMLInputElement>('input[name="teamSize"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  }

  it('saves the team size with the place in one PUT', async () => {
    const { container, onSave, onDone } = renderEditor();
    const input = container.querySelector<HTMLInputElement>('input[name="teamSize"]');
    expect(input?.closest('label')?.textContent).toContain('Размер команды');
    expect(input?.closest('label')?.textContent).toContain('человек');
    expect(input?.closest('label')?.textContent).toContain(
      'Все люди в вашей вертикали, включая руководителей команд.',
    );
    changeTeamSize(container, '38');
    await submitForm(container);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ teamSize: 38 });
    expect(onDone).toHaveBeenCalled();
  });

  it('keeps an unknown team size unknown and shows the stored one', async () => {
    const { container, onSave } = renderEditor({ entry: { ...entry, teamSize: 12 } });
    expect(container.querySelector<HTMLInputElement>('input[name="teamSize"]')?.value).toBe('12');
    changeTeamSize(container, '');
    await submitForm(container);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ teamSize: undefined });
  });

  it('refuses a team size that is not a whole number of people', async () => {
    const { container, onSave } = renderEditor();
    changeTeamSize(container, '0');
    await submitForm(container);
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Размер команды — целое число людей, от 1. Текст остался в форме.',
    );
  });
});
