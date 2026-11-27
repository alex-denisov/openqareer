import { useCallback, useState } from 'react';
import type { HhResumeEdit } from '../../../../../shared/hhCandidateSession';
import { applyHhResumeEditInSession, type HhResumeEditInput } from './hhDesktop';
import { pauseBetweenEdits } from './hhEditPace';
import { desktopFailureCode } from './hhSendModel';
import { forgetReadResumes } from './hhResumeReading';

/**
 * B678, срезы 3–4: правка раздела переносится в резюме hh.ru в окне кандидата. Место работы на hh.ru
 * общее для всех резюме, поэтому правка опыта — новое место с галочкой только этого резюме; у исходного
 * снимается галочка этого резюме, его текст не меняется. Без работодателя и должности — только копирование.
 */
export type HhApplyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'applying' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'failed'; readonly message: string; readonly retry: boolean; readonly captcha?: boolean };

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  not_signed_in: 'Войдите в hh.ru в окне приложения и нажмите ещё раз.',
  captcha: 'hh.ru просит подтвердить, что вы не робот: откройте окно hh.ru, подтвердите и нажмите ещё раз.',
  session_window_missing: 'Окно hh.ru закрылось. Нажмите ещё раз.',
  hh_window_not_opened: 'Окно hh.ru не открылось. Нажмите ещё раз.',
  hh_window_not_loaded: 'hh.ru не загрузился. Нажмите ещё раз.',
  hh_busy: 'Окно hh.ru занято другим действием. Нажмите ещё раз через минуту.',
  field_locked: 'hh.ru не даёт менять этот раздел сейчас. Скопируйте текст и вставьте на hh.ru.',
  field_invalid: 'hh.ru не принял текст. Скопируйте его и поправьте на hh.ru.',
  other_resumes_ticked:
    'На hh.ru это место работы отмечено и другими резюме: изменение задело бы их. Скопируйте текст и вставьте на hh.ru.',
  original_locked: 'hh.ru не даёт убрать прежнее место из этого резюме. Скопируйте текст и вставьте на hh.ru.',
  new_place_left:
    'Новое место добавилось в резюме, а прежнее место осталось. Откройте резюме на hh.ru и снимите у прежнего места галочку этого резюме.',
  saved_unconfirmed: 'hh.ru сохранил правку, но проверить её не получилось. Откройте резюме на hh.ru и посмотрите раздел.',
};
/** После этих отказов повтор добавил бы второе новое место. */
const NO_RETRY: ReadonlySet<string> = new Set(['new_place_left']);
const FAILURE_DEFAULT = 'Не получилось изменить резюме на hh.ru. Скопируйте текст и вставьте на hh.ru.';

function placeKnown(edit: HhResumeEdit): boolean {
  return Boolean(edit.employer?.trim() && edit.position?.trim() && edit.was.trim());
}

export function canApply(edit: HhResumeEdit): boolean {
  if (edit.section === 'skills') return (edit.added?.length ?? 0) > 0;
  if (edit.section === 'experience') return placeKnown(edit);
  return true;
}

export function editInput(resumeId: string, edit: HhResumeEdit): HhResumeEditInput | null {
  if (!canApply(edit)) return null;
  if (edit.section === 'skills') return { resumeId, section: 'skills', text: '', skills: edit.added ?? [] };
  if (edit.section === 'experience') {
    return { resumeId, section: 'experience', employer: edit.employer ?? '', position: edit.position ?? '', was: edit.was, text: edit.now };
  }
  return { resumeId, section: edit.section === 'title' ? 'title' : 'about', text: edit.now, skills: [] };
}

export function failureText(code: string | null | undefined): string {
  return (code && FAILURE_TEXT[code]) || FAILURE_DEFAULT;
}

export interface HhResumeApply {
  readonly stateOf: (id: string) => HhApplyState;
  readonly apply: (edit: HhResumeEdit) => Promise<boolean>;
  readonly applyAll: (edits: readonly HhResumeEdit[]) => Promise<void>;
  readonly busy: boolean;
}

export function useHhResumeApply(resumeId: string): HhResumeApply {
  const [states, setStates] = useState<Readonly<Record<string, HhApplyState>>>({});
  const set = (id: string, state: HhApplyState) => setStates((current) => ({ ...current, [id]: state }));
  const apply = useCallback(
    async (edit: HhResumeEdit): Promise<boolean> => {
      const input = editInput(resumeId, edit);
      if (!input) return false;
      set(edit.id, { kind: 'applying' });
      try {
        const report = await applyHhResumeEditInSession(input);
        if (report.outcome !== 'applied') {
          const code = report.failureCode ?? '';
          set(edit.id, { kind: 'failed', message: failureText(code), retry: !NO_RETRY.has(code), captcha: code === 'captcha' });
          return false;
        }
        forgetReadResumes();
        set(edit.id, { kind: 'applied' });
        return true;
      } catch (reason: unknown) {
        set(edit.id, { kind: 'failed', message: failureText(desktopFailureCode(reason)), retry: true });
        return false;
      }
    },
    [resumeId],
  );
  const applyAll = useCallback(
    async (edits: readonly HhResumeEdit[]) => {
      const queue = edits.filter(canApply);
      for (const [index, edit] of queue.entries()) {
        // По одной правке с паузой: окно hh.ru одно; после отказа площадки остальные не трогаем.
        if (index > 0) await pauseBetweenEdits();
        if (!(await apply(edit))) return;
      }
    },
    [apply],
  );
  const busy = Object.values(states).some((state) => state.kind === 'applying');
  return { stateOf: (id) => states[id] ?? { kind: 'idle' }, apply, applyAll, busy };
}
