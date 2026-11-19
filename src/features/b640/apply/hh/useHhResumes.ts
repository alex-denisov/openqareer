import { useCallback, useRef, useState } from 'react';
import type { HhResumeContent, HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../../coach/apiClient';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { useAsync } from '../../responses/data/useAsync';
import { openHhSignIn, readHhResumeContent, readHhResumes, summaryOf } from './hhDesktop';
import { forReview, readResumesForReview, type ReadPace } from './hhResumeReading';
import {
  getHhResumeReview,
  getHhResumes,
  saveHhResumes,
  type HhResumeVacancyReview,
} from './hhSessionApi';

export type HhPicker =
  | { readonly kind: 'closed' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'choose';
      readonly resumes: readonly HhResumeItem[];
      /** B678: сверка с вакансией; `null` — не получилась, выбор всё равно возможен. */
      readonly review: HhResumeVacancyReview | null;
    }
  | { readonly kind: 'error'; readonly text: string };

export interface HhResumesState {
  /** Что прочитано в прошлый раз: выбранное резюме и весь список. */
  readonly snapshot: HhResumeSnapshot | null;
  readonly loading: boolean;
  readonly picker: HhPicker;
  /** Открыть выбор: список и содержимое резюме читаются в сессии кандидата заново. */
  readonly openPicker: () => void;
  readonly closePicker: () => void;
  readonly signIn: () => void;
  readonly saving: boolean;
  readonly choose: (item: HhResumeItem) => void;
}

export interface HhResumesOptions {
  /** Темп чтения страниц резюме в окне hh.ru; тесты читают без пауз. */
  readonly pace?: ReadPace;
}

type ReviewOutcome = { readonly saved: HhResumeSnapshot | null; readonly review: HhResumeVacancyReview | null };

/** Читает резюме списка, сохраняет их для сверки и берёт сверку с вакансией; сбой сверки выбор не закрывает. */
async function reviewList(
  items: readonly HhResumeItem[],
  previous: HhResumeSnapshot | null,
  vacancyId: string,
  pace: ReadPace | undefined,
): Promise<ReviewOutcome & { readonly read: ReadonlyMap<string, HhResumeContent> }> {
  const contents = await readResumesForReview(items, pace);
  const read = new Map(contents.map((content) => [content.id, content]));
  const listed = new Set(items.map((item) => item.id));
  const kept = previous?.selected && listed.has(previous.selected.id) ? previous.selected : null;
  const selected = kept ? (read.get(kept.id) ?? kept) : null;
  try {
    const saved = await saveHhResumes(items.map(summaryOf), selected, contents.map(forReview));
    return { saved, review: await getHhResumeReview(vacancyId), read };
  } catch {
    return { saved: null, review: null, read };
  }
}

/** Резюме hh.ru кандидата: список и содержимое — из его сессии hh.ru; сверка с вакансией — на сервере. */
export function useHhResumes(vacancyId: string, options: HhResumesOptions = {}): HhResumesState {
  const load = useCallback((signal: AbortSignal) => getHhResumes(signal), []);
  const { state, replaceData } = useAsync(load, '');
  const [picker, setPicker] = useState<HhPicker>({ kind: 'closed' });
  const [saving, setSaving] = useState(false);
  const read = useRef<ReadonlyMap<string, HhResumeContent>>(new Map());
  const snapshot = state.data ?? null;

  const openPicker = () => {
    setPicker({ kind: 'reading' });
    readHhResumes()
      .then(async (list) => {
        if (list.kind !== 'ready') return setPicker({ kind: list.kind === 'empty' ? 'empty' : 'signin' });
        const outcome = await reviewList(list.resumes, snapshot, vacancyId, options.pace);
        read.current = outcome.read;
        if (outcome.saved) replaceData(outcome.saved);
        return setPicker({ kind: 'choose', resumes: list.resumes, review: outcome.review });
      })
      .catch(() => setPicker({ kind: 'error', text: 'Список резюме hh.ru не прочитался. Повторите.' }));
  };

  const choose = (item: HhResumeItem) => {
    if (picker.kind !== 'choose') return;
    const listed = picker.resumes.map(summaryOf);
    const known = read.current.get(item.id);
    setSaving(true);
    // Прочитанное для сверки сервер хранит сам: выбор шлёт только выбранное резюме.
    (known ? Promise.resolve(known) : readHhResumeContent(item))
      .then((content) => saveHhResumes(listed, content))
      .then((saved) => {
        // Снимка до выбора могло не быть (GET вернул null): ставим его целиком.
        replaceData(saved);
        setPicker({ kind: 'closed' });
      })
      .catch((reason: unknown) =>
        setPicker({ kind: 'error', text: apiErrorMessage(reason, 'Резюме не прочиталось. Выберите его ещё раз.') }),
      )
      .finally(() => setSaving(false));
  };

  return {
    snapshot,
    loading: state.status === 'loading',
    picker,
    openPicker,
    closePicker: () => setPicker({ kind: 'closed' }),
    signIn: () => {
      void openHhSignIn();
    },
    saving,
    choose,
  };
}
