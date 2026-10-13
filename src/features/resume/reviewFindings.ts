import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeDraft } from './resumeTypes';

const HAS_FIGURE = /\d/u;

/** Counts the roles whose confirmed bullets contain at least one figure. */
export function countRolesWithFigures(
  draft: Pick<ResumeDraft, 'experience'>,
  memory: readonly CandidateMemory[],
): { readonly withFigures: number; readonly total: number } {
  const statements = new Map(memory.map((item) => [item.id, item.statement]));
  const withFigures = draft.experience.filter((entry) =>
    entry.bulletMemoryIds.some((id) => HAS_FIGURE.test(statements.get(id) ?? '')),
  ).length;
  return { withFigures, total: draft.experience.length };
}

export function experienceFinding(
  draft: Pick<ResumeDraft, 'experience'>,
  memory: readonly CandidateMemory[],
): string | undefined {
  const { withFigures, total } = countRolesWithFigures(draft, memory);
  if (total === 0) return undefined;
  return `Результаты в цифрах: в ${withFigures} из ${total} мест.`;
}

export function aboutFinding(about: string | undefined): string | undefined {
  const text = about?.trim();
  if (!text) return undefined;
  const paragraphs = text.split(/\n{2,}/u).filter((part) => part.trim()).length;
  const sentences = text.split(/[.!?…]+(?:\s|$)/u).filter((part) => part.trim()).length;
  const paragraphLabel = paragraphs === 1 ? 'Один абзац' : `Абзацев: ${paragraphs}`;
  return `${paragraphLabel}, предложений: ${sentences}.`;
}
