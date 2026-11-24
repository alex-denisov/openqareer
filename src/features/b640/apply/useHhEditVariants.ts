import { useEffect, useRef, useState } from 'react';
import type { HhResumeEdit } from '../../../../shared/hhCandidateSession';
import { MAX_TEXT_VARIANTS, type TextVariant } from '../../../../shared/textVariants';
import { apiErrorMessage } from '../../coach/apiClient';
import { createHhEditVariant, listHhEditVariants, type HhEditVariantList } from './hhEditVariantApi';

export interface HhEditVariants {
  readonly total: number;
  readonly index: number;
  readonly remaining: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly select: (index: number) => void;
  readonly create: () => void;
}

type Stored = TextVariant<{ readonly added?: readonly string[] }>;
const EMPTY: HhEditVariantList = { variants: [], remaining: MAX_TEXT_VARIANTS };

function withVariant(edit: HhResumeEdit, variant: Stored | undefined): HhResumeEdit {
  if (!variant) return edit;
  const added = edit.section === 'skills' ? variant.payload?.added : undefined;
  return { ...edit, now: variant.text, ...(added ? { added } : {}) };
}

/** Первый текст — предложение платформы; сохранённые варианты листаются за ним. */
export function useHhEditVariants(
  edit: HhResumeEdit,
  shown: HhResumeEdit,
  onShow: (edit: HhResumeEdit) => void,
): HhEditVariants {
  const [list, setList] = useState<HhEditVariantList>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = useRef(false);
  const subjectId = edit.variantOf?.subjectId;
  useEffect(() => {
    if (!subjectId) return undefined;
    const controller = new AbortController();
    listHhEditVariants(subjectId, controller.signal)
      // Ответ, пришедший после нового варианта, его не стирает.
      .then((found) => (controller.signal.aborted || created.current ? undefined : setList(found)))
      // Список не пришёл: предложение платформы на месте, предел проверит сервер.
      .catch(() => undefined);
    return () => controller.abort();
  }, [subjectId]);
  const found = list.variants.findIndex((variant) => variant.text === shown.now);
  const show = (index: number, variants: readonly Stored[]) =>
    onShow(withVariant(edit, index > 0 ? variants[index - 1] : undefined));
  const create = async () => {
    if (!edit.variantOf) return;
    setBusy(true);
    setError(null);
    try {
      const next = await createHhEditVariant(edit.variantOf.vacancyId, edit.variantOf.subjectId);
      created.current = true;
      setList(next);
      show(next.variants.length, next.variants);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Другой вариант не собрался. Повторите.'));
    } finally {
      setBusy(false);
    }
  };
  return {
    total: 1 + list.variants.length,
    index: found + 1,
    remaining: list.remaining,
    busy,
    error,
    select: (index) => show(index, list.variants),
    create: () => void create(),
  };
}
