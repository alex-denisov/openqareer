import { useLetterApproval } from '../../vacancies/vacancyLetterApproval';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { approvalPitch } from './model/variantModel';
import type { LetterVariantsState } from './useLetterVariants';

/**
 * Одобрение письма с учётом выбранного варианта (B682): в снимок уходят тема и факты профиля
 * того текста, который кандидат одобряет, а не первого письма.
 */
export function useVariantApproval(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
): LetterScreenState {
  const approval = useLetterApproval({
    vacancyId,
    circle: letter.circle.circle,
    language: letter.language,
    tone: letter.tone,
    path: letter.circle.selectedPath,
    pitch: approvalPitch(letter.draft.pitch, variants.selected),
    body: letter.draft.text,
    includedWorkplaceIds: letter.draft.workplaces.map((workplace) => workplace.id),
    onResumeChanged: letter.draft.retry,
  });
  return { ...letter, approval };
}
