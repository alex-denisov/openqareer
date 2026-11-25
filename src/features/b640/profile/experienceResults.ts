import type { FactCorrectionOutcome } from '../../../../shared/factCorrection';
import { CoachApiError } from '../../coach/apiClient';
import { changeMemory } from '../../coach/coachApi';
import { addManualExperienceFact } from '../../resume/experienceFactApi';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import { editedDescription, type ExperienceForm } from './experienceForm';
import { correctFact, revertFactCorrection } from './factCorrectionApi';
import { statementsOf } from './profileModel';

async function freshStatements(): Promise<ReadonlyMap<string, string>> {
  forgetSharedRead('resume');
  return statementsOf(await getResumeStudio());
}

interface TextEdit {
  readonly memoryId: string;
  readonly text: string;
}

/** Записи, которые кандидат переписал: «Что делали» и строки «Результаты». */
export function editedTexts(
  entry: ResumeExperienceInput,
  initial: ExperienceForm,
  form: ExperienceForm,
): readonly TextEdit[] {
  const before = new Map(initial.results.map(({ key, text }) => [key, text]));
  const results = form.results.flatMap(({ key, memoryId, text }): TextEdit[] =>
    memoryId && text.trim() && text.trim() !== before.get(key)
      ? [{ memoryId, text: text.trim() }]
      : [],
  );
  const { descriptionMemoryId } = entry;
  const description = editedDescription(initial, form);
  return descriptionMemoryId && description
    ? [{ memoryId: descriptionMemoryId, text: description }, ...results]
    : results;
}

const FACT_CONFLICT = 'experience_fact_conflict';

const hasCode = (reason: unknown, code: string): boolean =>
  reason instanceof CoachApiError && reason.code === code;

/** Записи со слов кандидата, которые форма уже пробовала завести: ключ → тексты попыток. */
export interface FactWriter {
  readonly add: (key: string, statement: string, experienceId?: string) => Promise<string>;
  /** Ключ записи «Что делали» этой формы. */
  readonly descriptionKey: () => string;
  readonly dropDescription: () => Promise<void>;
}

/** Повтор после сбоя обновляет ту же запись: второй, без места, в профиле не остаётся. */
export function createFactWriter(): FactWriter {
  let descriptionKey: string = crypto.randomUUID();
  const tried = new Map<string, ReadonlySet<string>>();
  return {
    descriptionKey: () => descriptionKey,
    async add(key, statement, experienceId) {
      const before = tried.get(key) ?? new Set<string>();
      tried.set(key, new Set([...before, statement]));
      try {
        await addManualExperienceFact({ statement, experienceId, idempotencyKey: key });
      } catch (reason) {
        // Запись уже заведена прошлой попыткой с другим текстом.
        if (before.size === 0 || !hasCode(reason, FACT_CONFLICT)) throw reason;
        await changeMemory(key, { action: 'correct', statement });
      }
      return key;
    },
    async dropDescription() {
      if (!tried.has(descriptionKey)) return;
      await changeMemory(descriptionKey, { action: 'delete' });
      // Ключ удалённой записи сервер второй раз не принимает.
      descriptionKey = crypto.randomUUID();
    },
  };
}

/** Первое «Что делали» места: запись со слов кандидата. `null` — заводить нечего. */
export async function addDescription(
  entry: ResumeExperienceInput,
  form: ExperienceForm,
  facts: FactWriter,
): Promise<string | null> {
  if (entry.descriptionMemoryId) return null;
  const statement = form.description?.trim();
  return statement ? facts.add(facts.descriptionKey(), statement) : null;
}

/** Описание стёрли после сбоя: запись, на которую место не ссылается, убирается. */
export async function dropUnusedDescription(
  form: ExperienceForm,
  draft: ResumeDraft,
  facts: FactWriter,
): Promise<void> {
  const key = facts.descriptionKey();
  if (form.description?.trim() || draft.experience.some((e) => e.descriptionMemoryId === key))
    return;
  await facts.dropDescription();
}

/**
 * Сохраняет тексты места работы. Правка одной записи меняет и её копии, поэтому перед каждой следующей
 * записи перечитываются: копию, уже ставшую нужной, второй раз не пишем.
 */
export async function saveTexts(
  entry: ResumeExperienceInput,
  initial: ExperienceForm,
  form: ExperienceForm,
  facts: FactWriter,
  onSaved: (outcome: FactCorrectionOutcome) => void,
): Promise<void> {
  for (const { memoryId, text } of editedTexts(entry, initial, form)) {
    const before = (await freshStatements()).get(memoryId);
    if (before === undefined) throw new Error('profile_fact_missing');
    if (before === text) continue;
    const target = { kind: 'memory' as const, id: memoryId };
    onSaved(await correctFact({ target, before, after: text }));
  }
  for (const { key, memoryId, text } of form.results) {
    const statement = text.trim();
    if (memoryId || !statement) continue;
    await facts.add(key, statement, entry.id);
  }
}

/** «Отменить»: правки возвращаются в обратном порядке. */
export async function revertTexts(saved: readonly FactCorrectionOutcome[]): Promise<void> {
  for (const { id } of [...saved].reverse()) await revertFactCorrection(id);
}
