import { useCallback, useState } from 'react';
import { MAX_TEXT_VARIANTS, type VariantWish } from '../../../../shared/textVariants';
import { apiErrorMessage } from '../../coach/apiClient';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { letterBodyForCircle } from '../../vacancies/vacancyLetterModel';
import { useAsync } from '../responses/data/useAsync';
import { createLetterVariant, listLetterVariants, type LetterVariant } from './data/variantsApi';

export interface LetterVariantsState {
  /** Сколько всего текстов можно листать: первое письмо и его другие варианты. */
  readonly total: number;
  /** Какой текст сейчас в поле: 0 — первое письмо. */
  readonly index: number;
  readonly remaining: number;
  readonly select: (index: number) => void;
  readonly wishOpen: boolean;
  readonly setWishOpen: (open: boolean) => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly create: (wish: VariantWish) => void;
}

/**
 * Другие варианты письма: первое письмо остаётся нулевым, сохранённые варианты листаются.
 * Выбранный текст подставляется в поле письма; одобряется то, что в поле.
 */
export function useLetterVariants(vacancyId: string, letter: LetterScreenState): LetterVariantsState {
  const load = useCallback((signal: AbortSignal) => listLetterVariants(vacancyId, signal), [vacancyId]);
  const { state, setData } = useAsync(load, '');
  const [index, setIndex] = useState(0);
  const [wishOpen, setWishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = state.data?.variants ?? [];
  const { pitch, setText } = letter.draft;
  const circle = letter.circle.circle;

  const show = (next: number, variants: readonly LetterVariant[]) => {
    const variant = next > 0 ? variants[next - 1] : null;
    const source = variant?.payload ?? pitch;
    if (!source) return;
    setText(letterBodyForCircle(circle, source));
    setIndex(next);
  };

  return {
    total: 1 + stored.length,
    index: Math.min(index, stored.length),
    remaining: state.data?.remaining ?? MAX_TEXT_VARIANTS,
    wishOpen,
    setWishOpen,
    busy,
    error,
    select: (next) => show(next, stored),
    create: (wish) => {
      setBusy(true);
      setError(null);
      createLetterVariant(vacancyId, wish, {
        tone: letter.tone,
        ...(letter.language === 'auto' ? {} : { language: letter.language }),
      })
        .then((result) => {
          setData(() => ({ variants: result.variants, remaining: result.remaining }));
          show(result.variants.length, result.variants);
          setWishOpen(false);
        })
        .catch((reason: unknown) =>
          setError(apiErrorMessage(reason, 'Другой вариант не собрался. Повторите.')),
        )
        .finally(() => setBusy(false));
    },
  };
}
