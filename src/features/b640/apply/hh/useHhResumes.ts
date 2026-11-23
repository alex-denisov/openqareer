import { useCallback, useEffect, useRef, useState } from 'react';
import type { HhResumeContent, HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../../coach/apiClient';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { useAsync } from '../../responses/data/useAsync';
import { openHhSignIn, readHhResumeContent, readHhResumes, summaryOf } from './hhDesktop';
import { forReview, readResumesForReview, type ReadPace } from './hhResumeReading';
import {
  getHhResumeEdits,
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
      /** B678, a01b: число правок у каждого прочитанного резюме; нет числа — нет и метки. */
      readonly edits: ReadonlyMap<string, number>;
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
  /** `then` — после сохранения выбора (a01b: «Оптимизировать» ведёт к разбору правок). */
  readonly choose: (item: HhResumeItem, then?: () => void) => void;
}

export interface HhResumesOptions {
  /** Темп чтения страниц резюме в окне hh.ru; тесты читают без пауз. */
  readonly pace?: ReadPace;
}

type ReviewOutcome = {
  readonly saved: HhResumeSnapshot | null;
  readonly review: HhResumeVacancyReview | null;
  readonly edits: ReadonlyMap<string, number>;
};

/** Выбранное раньше, а без выбора и при одном резюме — оно само: выбирать не из чего. */
function keptSelection(
  previous: HhResumeSnapshot | null,
  items: readonly HhResumeItem[],
): string | null {
  const listed = new Set(items.map((item) => item.id));
  if (previous?.selected && listed.has(previous.selected.id)) return previous.selected.id;
  return items.length === 1 ? items[0]!.id : null;
}

/** «N правок» у каждого прочитанного резюме; сбой оставляет резюме без метки. */
async function editCounts(vacancyId: string, contents: readonly HhResumeContent[]): Promise<Map<string, number>> {
  const counted = await Promise.all(
    contents
      .filter((item) => item.sections)
      .map(({ id }) =>
        getHhResumeEdits(vacancyId, undefined, id)
          .then((result): [string, number] => [id, result.edits.length])
          .catch(() => null),
      ),
  );
  return new Map(counted.filter((entry): entry is [string, number] => entry !== null));
}

/** Читает резюме списка, сохраняет их для сверки и берёт сверку с вакансией; сбой сверки выбор не закрывает. */
async function reviewList(
  items: readonly HhResumeItem[],
  previous: HhResumeSnapshot | null,
  vacancyId: string,
  pace: ReadPace | undefined,
): Promise<ReviewOutcome & { readonly read: ReadonlyMap<string, HhResumeContent> }> {
  const contents = await readResumesForReview(items, pace);
  const read = new Map(contents.map((content) => [content.id, content]));
  const keptId = keptSelection(previous, items);
  const selected = keptId
    ? (read.get(keptId) ?? (previous?.selected?.id === keptId ? previous.selected : null))
    : null;
  try {
    const saved = await saveHhResumes(items.map(summaryOf), selected, contents.map(forReview));
    const review = await getHhResumeReview(vacancyId);
    return { saved, review, edits: await editCounts(vacancyId, contents), read };
  } catch {
    return { saved: null, review: null, edits: new Map(), read };
  }
}

interface OpenedList {
  readonly picker: HhPicker;
  readonly saved: HhResumeSnapshot | null;
  readonly read: ReadonlyMap<string, HhResumeContent>;
}

/** Открытие листа: список из сессии hh.ru, затем сверка и правки прочитанных резюме. */
async function openList(
  snapshot: HhResumeSnapshot | null,
  vacancyId: string,
  pace: ReadPace | undefined,
): Promise<OpenedList> {
  const list = await readHhResumes();
  if (list.kind !== 'ready') {
    return { picker: { kind: list.kind === 'empty' ? 'empty' : 'signin' }, saved: null, read: new Map() };
  }
  const { saved, review, edits, read } = await reviewList(list.resumes, snapshot, vacancyId, pace);
  return { picker: { kind: 'choose', resumes: list.resumes, review, edits }, saved, read };
}

/** Резюме, которое надо перечитать: выбранное без разделов или единственное без выбора. */
function needsReading(snapshot: HhResumeSnapshot | null): HhResumeItem | null {
  if (!snapshot) return null;
  const target = snapshot.selected ?? (snapshot.resumes.length === 1 ? snapshot.resumes[0] : null);
  if (!target || snapshot.selected?.sections) return null;
  const listed = snapshot.resumes.find((item) => item.id === target.id);
  return {
    id: target.id,
    title: target.title,
    url: `https://hh.ru/resume/${target.id}`,
    updatedLabel: listed?.updatedLabel,
  };
}

/**
 * B678: правкам нужны разделы выбранного резюме. Снимок без них (выбор до B678 или единственное
 * резюме без выбора) перечитывается в окне hh.ru один раз сам, без повторного выбора; сбой — как было.
 */
function useReadSelected(
  snapshot: HhResumeSnapshot | null,
  busy: boolean,
  replaceData: (data: HhResumeSnapshot) => void,
): void {
  const tried = useRef(false);
  // Чтение долгое: кандидат мог за это время выбрать другое резюме — его выбор не затираем.
  const now = useRef({ snapshot, busy });
  useEffect(() => {
    now.current = { snapshot, busy };
  }, [snapshot, busy]);
  const target = needsReading(snapshot);
  useEffect(() => {
    if (!target || !snapshot || tried.current) return;
    tried.current = true;
    Promise.resolve()
      .then(() => readHhResumeContent(target))
      .then(async (content) => {
        const still = () => now.current.snapshot === snapshot && !now.current.busy;
        if (!content || !still()) return;
        const saved = await saveHhResumes(snapshot.resumes, content);
        if (still()) replaceData(saved);
      })
      .catch(() => undefined);
  }, [target, snapshot, replaceData]);
}

/** Резюме hh.ru кандидата: список и содержимое — из его сессии hh.ru; сверка с вакансией — на сервере. */
export function useHhResumes(vacancyId: string, options: HhResumesOptions = {}): HhResumesState {
  const load = useCallback((signal: AbortSignal) => getHhResumes(signal), []);
  const { state, replaceData } = useAsync(load, '');
  const [picker, setPicker] = useState<HhPicker>({ kind: 'closed' });
  const [saving, setSaving] = useState(false);
  const read = useRef<ReadonlyMap<string, HhResumeContent>>(new Map());
  const snapshot = state.data ?? null;
  useReadSelected(snapshot, saving || picker.kind !== 'closed', replaceData);

  const openPicker = () => {
    setPicker({ kind: 'reading' });
    openList(snapshot, vacancyId, options.pace)
      .then((list) => {
        read.current = list.read;
        if (list.saved) replaceData(list.saved);
        return setPicker(list.picker);
      })
      .catch(() => setPicker({ kind: 'error', text: 'Список резюме hh.ru не прочитался. Повторите.' }));
  };

  const choose = (item: HhResumeItem, then?: () => void) => {
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
        then?.();
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
