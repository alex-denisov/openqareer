import { useCallback } from 'react';
import type { VariantControlsState } from '../../apply/VariantControls';
import { useTextVariants, type VariantField } from '../../apply/useTextVariants';
import { createPostVariant, listPostVariants, type DraftKind } from './postVariantsApi';

/** «Другой вариант» черновика LinkedIn: поста или комментария. */
export function usePostVariants(
  kind: DraftKind,
  draftId: string,
  field: VariantField,
): VariantControlsState {
  const load = useCallback(
    (signal: AbortSignal) => listPostVariants(kind, draftId, signal),
    [kind, draftId],
  );
  return useTextVariants({ load, create: (wish) => createPostVariant(draftId, wish) }, field);
}
