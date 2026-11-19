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
  /** Идентификатор выбранного варианта; `null` — в поле первое письмо. */
  readonly selectedId: string | null;
  /** Список вариантов прочитан. */
  /** Список вариантов прочитан или не прочитался: одобренный текст можно ставить в поле (B716). */
  readonly settled: boolean;
  /** Вернуть одобренный текст (B711): вариант встаёт выбранным, в поле — одобренный текст. */
  readonly restore: (variantId: string | null, body: string) => void;
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
 * Правки руками: у первого письма и у каждого варианта своя. Текст поля и ключ показанного
 * текста читаются из ссылок — переход после ответа сервера видит то, что набрано сейчас.
 */
function useVariantEdits(pitch: unknown, text: string): (toKey: string, generated: string) => string {
  const edits = useRef<VariantEdits>({});
  const shownKey = useRef(FIRST_LETTER_KEY);
  const latest = useRef(text);
  latest.current = text;
  // Письмо пересобрали (тон, язык, адресат): правки прежних текстов к нему не относятся.
  useEffect(() => {
    edits.current = {};
    shownKey.current = FIRST_LETTER_KEY;
  }, [pitch]);
  return (toKey, generated) => {
    const moved = switchVariant(
      edits.current,
      { key: shownKey.current, text: latest.current },
      { key: toKey, generated },
    );
    edits.current = moved.edits;
    shownKey.current = toKey;
    return moved.text;
  };
}

/** Показанный вариант: его данные и идентификатор; нулевой индекс — первое письмо. */
function chosenOf(stored: readonly LetterVariant[], current: number) {
  const variant = current > 0 ? stored[current - 1] : undefined;
  return { selected: variant?.payload ?? null, selectedId: variant?.id ?? null };
}

/** Одобренный текст встаёт в поле (B711): вариант — выбранным, если он ещё есть в списке. */
function restorer(
  stored: readonly LetterVariant[],
  moveTo: (toKey: string, generated: string) => string,
  apply: (text: string, index: number) => void,
): LetterVariantsState['restore'] {
  return (variantId, body) => {
    const at = variantId ? stored.findIndex((variant) => variant.id === variantId) : -1;
    apply(moveTo(at >= 0 ? stored[at]!.id : FIRST_LETTER_KEY, body), at + 1);
  };
}

type Recipient = ReturnType<typeof recipientForConnectionPath>;

/** С какими настройками письма пишется вариант: те же тон, язык и адресат. */
function letterRequest(letter: LetterScreenState, recipient: Recipient | undefined) {
  return {
    tone: letter.tone,
    ...(letter.language === 'auto' ? {} : { language: letter.language }),
    ...(recipient ? { recipient } : {}),
  };
}

/**
 * Другие варианты письма: первое письмо остаётся нулевым, сохранённые варианты листаются.
 * Выбранный текст подставляется в поле письма; одобряется то, что в поле.
 */
export function useLetterVariants(vacancyId: string, letter: LetterScreenState): LetterVariantsState {
  const load = useCallback((signal: AbortSignal) => listLetterVariants(vacancyId, signal), [vacancyId]);
  const { state, replaceData } = useAsync(load, '');
  const [index, setIndex] = useState(0);
  const [wishOpen, setWishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pitch, text, setText, loading } = letter.draft;
  const moveTo = useVariantEdits(pitch, text);
  const { circle, selectedPath: path } = letter.circle;
  const recipient = path ? recipientForConnectionPath(path) : undefined;
  const stored = variantsFor(state.data?.variants ?? [], recipient?.name ?? '');

  // Письмо пересобрали (тон, язык, адресат): в поле снова первое письмо.
  useEffect(() => setIndex(0), [pitch]);
  const current = Math.min(index, stored.length);

  const show = (next: number, variants: readonly LetterVariant[]) => {
    const variant = next > 0 ? variants[next - 1] : null;
    const source = variant?.payload ?? pitch;
    if (!source || loading) return;
    setText(moveTo(variant?.id ?? FIRST_LETTER_KEY, letterBodyForCircle(circle, source)));
    setIndex(next);
  };

  return {
    total: 1 + stored.length,
    index: current,
    ...chosenOf(stored, current),
    settled: state.status !== 'loading',
    restore: restorer(stored, moveTo, (body, at) => { setText(body); setIndex(at); }),
    remaining: state.data?.remaining ?? MAX_TEXT_VARIANTS,
    locked: loading || !pitch,
    wishOpen, setWishOpen,
    busy,
    error,
    select: (next) => show(next, stored),
    create: (wish) => {
      setBusy(true);
      setError(null);
      createLetterVariant(vacancyId, wish, letterRequest(letter, recipient))
        .then((result) => {
          replaceData({ variants: result.variants, remaining: result.remaining });
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
