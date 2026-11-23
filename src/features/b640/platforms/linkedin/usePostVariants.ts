import { useCallback, useRef, useState } from 'react';
import { MAX_TEXT_VARIANTS } from '../../../../../shared/textVariants';
import { apiErrorMessage } from '../../../coach/apiClient';
import type { VariantControlsState } from '../../apply/VariantControls';
import { switchVariant, type VariantEdits } from '../../apply/model/variantModel';
import { useAsync } from '../../responses/data/useAsync';
import { createPostVariant, listPostVariants, type PostVariant } from './postVariantsApi';

const DRAFT_KEY = 'draft';

interface Field {
  /** Исходный текст черновика: первый в листании. */
  readonly draftText: string;
  readonly text: string;
  readonly setText: (text: string) => void;
}

/** Переход поля к другому тексту: правка уходящего текста остаётся за ним. */
function useFieldSwitch(field: Field): (toKey: string, generated: string) => void {
  const edits = useRef<VariantEdits>({});
  const shownKey = useRef(DRAFT_KEY);
  // Ответ сервера приходит позже: переход видит то, что набрано в поле сейчас.
  const latest = useRef(field.text);
  latest.current = field.text;
  return (toKey, generated) => {
    const moved = switchVariant(
      edits.current,
      { key: shownKey.current, text: latest.current },
      { key: toKey, generated },
    );
    edits.current = moved.edits;
    shownKey.current = toKey;
    field.setText(moved.text);
  };
}

/**
 * «Другой вариант» поста: черновик — первый текст, сохранённые варианты листаются «‹ N из M ›».
 * Правка руками остаётся за своим текстом; одобряется то, что в поле.
 */
export function usePostVariants(draftId: string, field: Field): VariantControlsState {
  const load = useCallback((signal: AbortSignal) => listPostVariants(draftId, signal), [draftId]);
  const { state, replaceData } = useAsync(load, '');
  const [index, setIndex] = useState(0);
  const [wishOpen, setWishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = state.data?.variants ?? [];
  const moveTo = useFieldSwitch(field);
  const show = (next: number, variants: readonly PostVariant[]) => {
    const variant = next > 0 ? variants[next - 1] : undefined;
    moveTo(variant?.id ?? DRAFT_KEY, variant?.text ?? field.draftText);
    setIndex(next);
  };

  return {
    total: 1 + stored.length,
    index: Math.min(index, stored.length),
    remaining: state.data?.remaining ?? MAX_TEXT_VARIANTS,
    locked: busy,
    select: (next) => show(next, stored),
    wishOpen,
    setWishOpen,
    busy,
    error,
    create: (wish) => {
      setBusy(true);
      setError(null);
      createPostVariant(draftId, wish)
        .then((result) => {
          replaceData({ variants: result.variants, remaining: result.remaining });
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
