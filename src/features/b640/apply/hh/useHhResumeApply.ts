import { useCallback, useState } from 'react';
import type { HhResumeEdit } from '../../../../../shared/hhCandidateSession';
import { applyHhResumeEditInSession, type HhResumeEditInput } from './hhDesktop';
import { pauseBetweenEdits } from './hhEditPace';
import { forgetReadResumes } from './hhResumeReading';

/**
 * B678, срез 3: правка раздела переносится в резюме hh.ru в окне кандидата. Опыт по местам — только
 * копированием: место работы на hh.ru общее для всех резюме, правка изменила бы его везде.
 */
export type HhApplyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'applying' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'failed'; readonly message: string };

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  not_signed_in: 'Войдите в hh.ru в окне приложения и нажмите ещё раз.',
  captcha: 'hh.ru просит подтвердить, что вы не робот: откройте окно hh.ru, подтвердите и нажмите ещё раз.',
  hh_busy: 'Окно hh.ru занято другим действием. Нажмите ещё раз через минуту.',
  field_locked: 'hh.ru не даёт менять этот раздел сейчас. Скопируйте текст и вставьте на hh.ru.',
  field_invalid: 'hh.ru не принял текст. Скопируйте его и поправьте на hh.ru.',
  saved_unconfirmed: 'hh.ru сохранил правку, но проверить её не получилось. Откройте резюме на hh.ru и посмотрите раздел.',
};
const FAILURE_DEFAULT = 'Не получилось изменить резюме на hh.ru. Скопируйте текст и вставьте на hh.ru.';

export function canApply(edit: HhResumeEdit): boolean {
  return edit.section === 'title' || edit.section === 'about' || (edit.section === 'skills' && (edit.added?.length ?? 0) > 0);
}

export function editInput(resumeId: string, edit: HhResumeEdit): HhResumeEditInput | null {
  if (!canApply(edit)) return null;
  if (edit.section === 'skills') return { resumeId, section: 'skills', text: '', skills: edit.added ?? [] };
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
          set(edit.id, { kind: 'failed', message: failureText(report.failureCode) });
          return false;
        }
        forgetReadResumes();
        set(edit.id, { kind: 'applied' });
        return true;
      } catch {
        set(edit.id, { kind: 'failed', message: FAILURE_DEFAULT });
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
