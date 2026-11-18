import { useCallback, useState } from 'react';
import type { HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../../coach/apiClient';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { useAsync } from '../../responses/data/useAsync';
import {
  openHhSignIn,
  readHhResumeContent,
  readHhResumes,
  summaryOf,
  type HhSessionRead,
} from './hhDesktop';
import { getHhResumes, saveHhResumes } from './hhSessionApi';

export type HhPicker =
  | { readonly kind: 'closed' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'choose'; readonly resumes: readonly HhResumeItem[] }
  | { readonly kind: 'error'; readonly text: string };

function pickerOf(read: HhSessionRead): HhPicker {
  if (read.kind === 'ready') return { kind: 'choose', resumes: read.resumes };
  return { kind: read.kind === 'empty' ? 'empty' : 'signin' };
}

export interface HhResumesState {
  /** Что прочитано в прошлый раз: выбранное резюме и весь список. */
  readonly snapshot: HhResumeSnapshot | null;
  readonly loading: boolean;
  readonly picker: HhPicker;
  /** Открыть выбор: список читается в сессии кандидата заново. */
  readonly openPicker: () => void;
  readonly closePicker: () => void;
  readonly signIn: () => void;
  readonly saving: boolean;
  readonly choose: (item: HhResumeItem) => void;
}

/** Резюме hh.ru кандидата: список и содержимое выбранного — из его сессии hh.ru. */
export function useHhResumes(): HhResumesState {
  const load = useCallback((signal: AbortSignal) => getHhResumes(signal), []);
  const { state, setData } = useAsync(load, '');
  const [picker, setPicker] = useState<HhPicker>({ kind: 'closed' });
  const [saving, setSaving] = useState(false);

  const openPicker = () => {
    setPicker({ kind: 'reading' });
    readHhResumes()
      .then((read) => setPicker(pickerOf(read)))
      .catch(() => setPicker({ kind: 'error', text: 'Список резюме hh.ru не прочитался. Повторите.' }));
  };

  const choose = (item: HhResumeItem) => {
    if (picker.kind !== 'choose') return;
    const listed = picker.resumes.map(summaryOf);
    setSaving(true);
    readHhResumeContent(item)
      .then((content) => saveHhResumes(listed, content))
      .then((saved) => {
        setData(() => saved);
        setPicker({ kind: 'closed' });
      })
      .catch((reason: unknown) =>
        setPicker({ kind: 'error', text: apiErrorMessage(reason, 'Резюме не прочиталось. Выберите его ещё раз.') }),
      )
      .finally(() => setSaving(false));
  };

  return {
    snapshot: state.data ?? null,
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
