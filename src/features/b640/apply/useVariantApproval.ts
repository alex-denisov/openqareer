import { useCallback, useEffect, useRef, useState } from 'react';
import { useLetterApproval } from '../../vacancies/vacancyLetterApproval';
import {
  readLatestLetterApproval,
  type StoredLetterApproval,
} from '../../vacancies/vacancyLetterApi';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { useAsync } from '../responses/data/useAsync';
import { approvalPitch } from './model/variantModel';
import type { LetterVariantsState } from './useLetterVariants';

/** Одобрение на сервере и придержанный черновик письма. */
export interface ApprovalHold {
  /** Последнее одобрение вакансии (B711); `null` — не одобряли или ещё не прочитано. */
  readonly stored: StoredLetterApproval | null;
  /** Черновик не просим: одобрение ещё читается или письмо одобрено и не снято «Изменить». */
  readonly hold: boolean;
  /** «Изменить»: одобрение снято, черновик снова нужен для нового одобрения. */
  readonly release: () => void;
}

/**
 * Одобренное письмо открывается своим текстом сразу после чтения одобрения: модель не пишет
 * черновик, который всё равно заменит одобренный текст (было 10–15 с «Собираем письмо…»).
 */
export function useApprovalHold(vacancyId: string): ApprovalHold {
  const load = useCallback(
    (signal: AbortSignal) => readLatestLetterApproval(vacancyId, signal),
    [vacancyId],
  );
  const { state } = useAsync(load, '');
  const [released, setReleased] = useState(false);
  const stored = state.data ?? null;
  const checked = state.status !== 'loading';
  const release = useCallback(() => setReleased(true), []);
  return { stored, hold: !checked || (stored !== null && !released), release };
}

/**
 * Одобрение, сохранённое на сервере (B711), встаёт в поле, когда прочитаны варианты. Черновик при
 * этом придержан; если его всё же просили (B716: круги не загрузились), ждём, пока он соберётся, —
 * иначе пришедшее письмо перезаписало бы одобренный текст.
 */
function useRestoredApproval(
  approvalHold: ApprovalHold,
  letter: LetterScreenState,
  variants: LetterVariantsState,
): StoredLetterApproval | null {
  const { stored, hold } = approvalHold;
  const [applied, setApplied] = useState<StoredLetterApproval | null>(null);
  const { pitch, loading, error } = letter.draft;
  const circlesFailed = !letter.circles.loading && letter.circles.error !== '';
  const draftSettled = !loading && (pitch !== null || error !== '' || circlesFailed);
  const { settled: variantsSettled, restore } = variants;
  useEffect(() => {
    if (!stored || applied || !variantsSettled || !(hold || draftSettled)) return;
    restore(stored.variantId, stored.body);
    setApplied(stored);
  }, [stored, applied, hold, draftSettled, variantsSettled, restore]);
  useKeptTextAfterRelease(applied, hold, letter, restore);
  return applied;
}

/**
 * После «Изменить» черновик просится заново, а текст в поле — одобренный, возможно уже
 * исправленный. Пришедший черновик его не заменяет: возвращаем текст, что был в поле до него.
 */
function useKeptTextAfterRelease(
  applied: StoredLetterApproval | null,
  hold: boolean,
  letter: LetterScreenState,
  restore: LetterVariantsState['restore'],
): void {
  const { pitch, text } = letter.draft;
  const kept = useRef<string | null>(null);
  const waiting = applied !== null && !hold;
  useEffect(() => {
    if (!waiting) return;
    if (pitch === null) {
      kept.current = text;
      return;
    }
    if (kept.current === null) return;
    restore(applied.variantId, kept.current);
    kept.current = null;
  }, [waiting, pitch, text, applied, restore]);
}

/**
 * Одобрение письма с учётом выбранного варианта (B682): в снимок уходят тема и факты профиля
 * того текста, который кандидат одобряет, а не первого письма.
 */
export function useVariantApproval(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
  approvalHold: ApprovalHold,
): LetterScreenState {
  const restored = useRestoredApproval(approvalHold, letter, variants);
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
  const { release } = approvalHold;
  const { reset } = approval;
  const resetAndRelease = useCallback(() => {
    reset();
    release();
  }, [reset, release]);
  // B645: после перезагрузки черновика нет — язык и тон одобренного письма берутся из снимка.
  const shown =
    approval.saved && approval.saved.documentId === restored?.documentId ? restored : null;
  return {
    ...letter,
    language: shown?.language ?? letter.language,
    tone: shown?.tone ?? letter.tone,
    approval: { ...approval, reset: resetAndRelease },
  };
}
