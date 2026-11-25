import { useEffect, useRef, useState } from 'react';
import type { HhResumeSnapshot, HhResumeSummary } from '../../../../../shared/hhCandidateSession';
import { applyHhResumeEditInSession, copyHhResume, deleteHhCopy, hideHhCopy, readHhResumeContent, readHhResumes, summaryOf } from './hhDesktop';
import { pauseBetweenEdits } from './hhEditPace';
import { createHiddenCopy, type HiddenCopyDeps, type HiddenCopyStep } from './hhHiddenCopy';
import { forgetReadResumes } from './hhResumeReading';
import { chooseHhResumeFor, getHhResumeEdits, getHhResumeReview, saveHhCopyFor, saveHhResumes } from './hhSessionApi';
import { failureText } from './useHhResumeApply';

/** B787: ход создания резюме под вакансию. */
export type HhCopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string; readonly retry: boolean; readonly window: boolean };

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  limit_reached: 'На hh.ru уже 20 резюме. Удалите ненужное на hh.ru и повторите.',
  copy_removed: 'Копию не удалось скрыть, она удалена с hh.ru.',
  copy_left_visible: 'Копия на hh.ru может быть видна работодателям. Скройте или удалите её на hh.ru.',
  copy_left_captcha: 'hh.ru просит подтвердить, что вы не робот. Копия может быть видна работодателям.',
  copy_ambiguous: 'На hh.ru появились новые резюме, копия среди них не определилась. Удалите лишнее на hh.ru и повторите.',
  source_missing: 'Этого резюме нет на hh.ru. Выберите другое.',
  copy_not_listed: 'Резюме под вакансию не нашлось в списке hh.ru.',
  copy_not_read: 'Резюме под вакансию не прочиталось на hh.ru.',
  copy_unconfirmed: 'hh.ru не ответил, создано ли резюме.',
  field_locked: 'hh.ru не даёт менять резюме под вакансию.',
  field_invalid: 'hh.ru не принял текст правки.',
};
const FAILURE_DEFAULT = 'Резюме под вакансию не готово: hh.ru не принял изменения.';
/** Повтор добавил бы второе место работы. */
const NO_RETRY: ReadonlySet<string> = new Set(['new_place_left']);
const SHARED: ReadonlySet<string> = new Set(['not_signed_in', 'captcha', 'session_window_missing', 'hh_window_not_opened', 'hh_window_not_loaded', 'hh_busy', 'other_resumes_ticked', 'new_place_left']);
const IN_WINDOW: ReadonlySet<string> = new Set(['captcha', 'copy_left_captcha', 'copy_left_visible', 'new_place_left']);

export function copyFailureText(code: string): string {
  return FAILURE_TEXT[code] ?? (SHARED.has(code) ? failureText(code) : FAILURE_DEFAULT);
}

function stepText(step: HiddenCopyStep): string {
  if (step.kind === 'copying') return 'Создаём резюме на hh.ru';
  if (step.kind === 'hiding') return 'Скрываем резюме на hh.ru';
  return `Заполняем резюме: ${step.done} из ${step.total}`;
}

function depsFor(vacancyId: string, replace: (saved: HhResumeSnapshot) => void): HiddenCopyDeps {
  return {
    readList: readHhResumes,
    readContent: readHhResumeContent,
    copy: copyHhResume,
    hide: hideHhCopy,
    remove: deleteHhCopy,
    edit: applyHhResumeEditInSession,
    saveCopy: async (copy) => replace(await saveHhCopyFor(vacancyId, copy)),
    choose: async (list, content) => {
      forgetReadResumes();
      await saveHhResumes(list.map(summaryOf), content, undefined, vacancyId);
      replace(await chooseHhResumeFor(vacancyId, content.id));
    },
    edits: async () => (await getHhResumeEdits(vacancyId)).edits,
    pause: pauseBetweenEdits,
  };
}

/** Выбрана сама копия — исходное то, с которого она снята. */
function sourceOf(snapshot: HhResumeSnapshot | null): HhResumeSummary | null {
  const selected = snapshot?.selected;
  if (!selected) return null;
  if (snapshot.copy?.copyId !== selected.id) return { id: selected.id, title: selected.title };
  const { sourceId } = snapshot.copy;
  return { id: sourceId, title: snapshot.resumes.find((item) => item.id === sourceId)?.title ?? '' };
}

export interface HhHiddenCopy {
  readonly state: HhCopyState;
  readonly create: () => void;
}

export function useHhHiddenCopy(
  vacancyId: string,
  vacancyTitle: string,
  snapshot: HhResumeSnapshot | null,
  replace: (saved: HhResumeSnapshot) => void,
): HhHiddenCopy {
  const [state, setState] = useState<HhCopyState>({ kind: 'idle' });
  const running = useRef(false);
  const create = () => {
    const source = sourceOf(snapshot);
    if (!source || running.current) return;
    running.current = true;
    void createHiddenCopy(
      depsFor(vacancyId, replace),
      { source, vacancyTitle, started: snapshot?.copy },
      (step) => setState({ kind: 'running', text: stepText(step) }),
    )
      .then((result) =>
        setState(
          result.ok
            ? { kind: 'idle' }
            : { kind: 'failed', text: copyFailureText(result.code), retry: !NO_RETRY.has(result.code), window: IN_WINDOW.has(result.code) },
        ),
      )
      .finally(() => {
        running.current = false;
      });
  };
  return { state, create };
}

/** Чего выбранному резюме не хватает для вакансии; пока не сверено — ничего. */
export function useHhMissing(vacancyId: string, snapshot: HhResumeSnapshot | null): readonly string[] {
  const id = snapshot?.selected?.id ?? null;
  const key = id ? `${vacancyId}:${id}:${snapshot?.readAt ?? ''}` : null;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly missing: readonly string[] } | null>(null);
  useEffect(() => {
    if (!key || !id) return undefined;
    let live = true;
    getHhResumeReview(vacancyId)
      .then((review) => {
        const fit = review.resumes.find((entry) => entry.resumeId === id);
        if (live) setLoaded({ key, missing: fit?.status === 'gaps' ? fit.missing : [] });
      })
      // Сверка не получилась: отклик уходит выбранным резюме, как и без неё.
      .catch(() => live && setLoaded({ key, missing: [] }));
    return () => {
      live = false;
    };
  }, [vacancyId, id, key]);
  return loaded?.key === key ? loaded.missing : [];
}
