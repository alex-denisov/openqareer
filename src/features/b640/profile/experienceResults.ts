import type { FactCorrectionChange } from '../../../../shared/factCorrection';
import { addManualExperienceFact } from '../../resume/experienceFactApi';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import type { ResumeExperienceInput } from '../../resume/resumeTypes';
import type { ExperienceForm } from './experienceForm';
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
  const description = form.description?.trim();
  return descriptionMemoryId && description && description !== initial.description
    ? [{ memoryId: descriptionMemoryId, text: description }, ...results]
    : results;
}

/**
 * Сохраняет тексты места работы. Правка одной записи меняет и её копии, поэтому перед каждой следующей
 * записи перечитываются: копию, уже ставшую нужной, второй раз не пишем.
 */
export async function saveTexts(
  entry: ResumeExperienceInput,
  initial: ExperienceForm,
  form: ExperienceForm,
  onSaved: (changes: readonly FactCorrectionChange[]) => void,
): Promise<void> {
  for (const { memoryId, text } of editedTexts(entry, initial, form)) {
    const before = (await freshStatements()).get(memoryId);
    if (before === undefined) throw new Error('profile_fact_missing');
    if (before === text) continue;
    const target = { kind: 'memory' as const, id: memoryId };
    onSaved((await correctFact({ target, before, after: text })).changes);
  }
  for (const { key, memoryId, text } of form.results) {
    const statement = text.trim();
    if (memoryId || !statement) continue;
    await addManualExperienceFact({ statement, experienceId: entry.id, idempotencyKey: key });
  }
}

/** «Отменить»: правки возвращаются в обратном порядке. */
export async function revertTexts(
  saved: ReadonlyArray<readonly FactCorrectionChange[]>,
): Promise<void> {
  for (const changes of [...saved].reverse()) await revertFactCorrection(changes);
}
