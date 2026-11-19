import { useCallback, useEffect, useState } from 'react';
import { useLetterApproval } from '../../vacancies/vacancyLetterApproval';
import {
  readLatestLetterApproval,
  type StoredLetterApproval,
} from '../../vacancies/vacancyLetterApi';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { useAsync } from '../responses/data/useAsync';
import { approvalPitch } from './model/variantModel';
import type { LetterVariantsState } from './useLetterVariants';

/**
 * Одобрение, сохранённое на сервере (B711): возвращается, когда письмо уже собрано и варианты
 * прочитаны, — иначе пришедший черновик перезаписал бы одобренный текст.
 */
function useRestoredApproval(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
): StoredLetterApproval | null {
  const load = useCallback(
    (signal: AbortSignal) => readLatestLetterApproval(vacancyId, signal),
    [vacancyId],
  );
  const { state } = useAsync(load, '');
  const [applied, setApplied] = useState<StoredLetterApproval | null>(null);
  const stored = state.data ?? null;
  const { pitch, loading, error } = letter.draft;
  // B716: круги связей не загрузились — черновик не просят вовсе; одобренный текст встаёт сразу.
  const circlesFailed = !letter.circles.loading && letter.circles.error !== '';
  const draftSettled = !loading && (pitch !== null || error !== '' || circlesFailed);
  const { settled: variantsSettled, restore } = variants;
  useEffect(() => {
    if (!stored || applied || !draftSettled || !variantsSettled) return;
    restore(stored.variantId, stored.body);
    setApplied(stored);
  }, [stored, applied, draftSettled, variantsSettled, restore]);
  return applied;
}

/**
 * Одобрение письма с учётом выбранного варианта (B682): в снимок уходят тема и факты профиля
 * того текста, который кандидат одобряет, а не первого письма.
 */
export function useVariantApproval(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
): LetterScreenState {
  const restored = useRestoredApproval(vacancyId, letter, variants);
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
    variantId: variants.selectedId,
    restored,
  });
  return { ...letter, approval };
}
