import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TEXT_VARIANTS, type VariantWish } from '../../../../shared/textVariants';
import { apiErrorMessage } from '../../coach/apiClient';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import {
  letterBodyForCircle,
  recipientForConnectionPath,
} from '../../vacancies/vacancyLetterModel';
import { useAsync } from '../responses/data/useAsync';
import { createLetterVariant, listLetterVariants, type LetterVariant } from './data/variantsApi';
import { FIRST_LETTER_KEY, switchVariant, type VariantEdits } from './model/variantModel';

export interface LetterVariantsState {
  /** Сколько всего текстов можно листать: первое письмо и его другие варианты. */
  readonly total: number;
  /** Какой текст сейчас в поле: 0 — первое письмо. */
  readonly index: number;
  /** Данные выбранного варианта; `null` — в поле первое письмо. */
  readonly selected: LetterVariant['payload'];
  readonly remaining: number;
  /** Листать нельзя, пока письмо пересобирается. */
  readonly locked: boolean;
  readonly select: (index: number) => void;
  readonly wishOpen: boolean;
  readonly setWishOpen: (open: boolean) => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly create: (wish: VariantWish) => void;
}

/** Варианты, написанные тому же адресату, что выбран сейчас. */
export function variantsFor(
  variants: readonly LetterVariant[],
  recipientName: string,
): readonly LetterVariant[] {
  return variants.filter((variant) => (variant.payload?.recipientName ?? '') === recipientName);
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
  const { pitch, text, setText, loading } = letter.draft;
  // Правки руками: у первого письма и у каждого варианта своя.
  const edits = useRef<VariantEdits>({});
  const { circle, selectedPath: path } = letter.circle;
  const recipient = path ? recipientForConnectionPath(path) : undefined;
  const stored = variantsFor(state.data?.variants ?? [], recipient?.name ?? '');

  // Письмо пересобрали (тон, язык, адресат): в поле снова первое письмо.
  useEffect(() => {
    setIndex(0);
    edits.current = {};
  }, [pitch]);
  const current = Math.min(index, stored.length);

  const show = (next: number, variants: readonly LetterVariant[]) => {
    const variant = next > 0 ? variants[next - 1] : null;
    const source = variant?.payload ?? pitch;
    if (!source || loading) return;
    const key = (at: number) => (at > 0 ? (variants[at - 1]?.id ?? FIRST_LETTER_KEY) : FIRST_LETTER_KEY);
    const moved = switchVariant(
      edits.current,
      { key: key(current), text },
      { key: key(next), generated: letterBodyForCircle(circle, source) },
    );
    edits.current = moved.edits;
    setText(moved.text);
    setIndex(next);
  };

  return {
    total: 1 + stored.length,
    index: current,
    selected: current > 0 ? (stored[current - 1]?.payload ?? null) : null,
    remaining: state.data?.remaining ?? MAX_TEXT_VARIANTS,
    locked: loading || !pitch,
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
        ...(recipient ? { recipient } : {}),
      })
        .then((result) => {
          setData(() => ({ variants: result.variants, remaining: result.remaining }));
          const mine = variantsFor(result.variants, recipient?.name ?? '');
          show(mine.length, mine);
          setWishOpen(false);
        })
        .catch((reason: unknown) =>
          setError(apiErrorMessage(reason, 'Другой вариант не собрался. Повторите.')),
        )
        .finally(() => setBusy(false));
    },
  };
}
