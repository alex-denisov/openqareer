import { useCallback, useEffect, useRef, useState } from 'react';
import { hhSectionsRead, type HhResumeContent, type HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../../coach/apiClient';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { useAsync } from '../../responses/data/useAsync';
import { HH_CAPTCHA, openHhSignIn, readHhResumeContent, readHhResumes, summaryOf } from './hhDesktop';
import { forReview, readResumesForReview, type ReadPace } from './hhResumeReading';
import {
  chooseHhResumeFor,
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
  | { readonly kind: 'error'; readonly text: string; readonly captcha?: boolean };

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
  readonly choose: (item: HhResumeItem, onChosen?: () => void) => void;
  /** Выбрать из известных резюме, без листа. */
  readonly pick: (resumeId: string) => Promise<void>;
  /** Прочитать страницу выбранного резюме ещё раз. */
  readonly reread: () => void;
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
  const kept = previous?.selected?.text && listed.has(previous.selected.id) ? previous.selected : null;
  const selected = kept ? (read.get(kept.id) ?? kept) : null;
  try {
    const saved = await saveHhResumes(items.map(summaryOf), selected, contents.map(forReview), vacancyId);
    return { saved, review: await getHhResumeReview(vacancyId, true), read };
  } catch {
    return { saved: null, review: null, read };
  }
}

/** Разделы не прочитаны: правок по такому резюме нет (409), поэтому выбранное читаем сами, один раз. */
function useSectionsRefresh(vacancyId: string, snapshot: HhResumeSnapshot | null, replaceData: (saved: HhResumeSnapshot) => void) {
  const refreshed = useRef<{ readonly id: string; readonly done: Promise<void> } | null>(null);
  // Снимок после перечитывания: замыкание открытия листа помнит прежний.
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  const [refreshing, setRefreshing] = useState(false);
  const reread = useCallback(() => {
    const selected = snapshot?.selected;
    if (!snapshot || !selected) return;
    setRefreshing(true);
    const run = async () => {
      const item = { id: selected.id, title: selected.title, url: `https://hh.ru/resume/${selected.id}` };
      const saved = await saveHhResumes(snapshot.resumes, await readHhResumeContent(item), undefined, vacancyId);
      latest.current = saved;
      replaceData(saved);
    };
    // Не прочиталось (вход, капча) — отклик уходит выбранным резюме как есть.
    refreshed.current = { id: selected.id, done: run().catch(() => undefined).finally(() => setRefreshing(false)) };
  }, [vacancyId, snapshot, replaceData]);
  useEffect(() => {
    const selected = snapshot?.selected;
    if (!selected || hhSectionsRead(selected.sections) || refreshed.current?.id === selected.id) return;
    reread();
  }, [snapshot, reread]);
  const settled = async () => {
    await refreshed.current?.done;
    return latest.current;
  };
  return { refreshing, settled, reread };
}

async function saveChoice(
  vacancyId: string,
  listed: HhResumeSnapshot['resumes'],
  item: HhResumeItem,
  known: HhResumeContent | undefined,
): Promise<HhResumeSnapshot> {
  await saveHhResumes(listed, known ?? (await readHhResumeContent(item)), undefined, vacancyId);
  return chooseHhResumeFor(vacancyId, item.id);
}

function listFailure(reason: unknown): HhPicker {
  return {
    kind: 'error',
    text: 'Список резюме hh.ru не прочитался. Повторите.',
    captcha: reason instanceof Error && reason.message === HH_CAPTCHA,
  };
}

/** Резюме hh.ru кандидата: список и содержимое — из его сессии hh.ru; сверка с вакансией — на сервере. */
export function useHhResumes(vacancyId: string, options: HhResumesOptions = {}): HhResumesState {
  const load = useCallback((signal: AbortSignal) => getHhResumes(signal, vacancyId), [vacancyId]);
  const { state, replaceData } = useAsync(load, '');
  const [picker, setPicker] = useState<HhPicker>({ kind: 'closed' });
  const [saving, setSaving] = useState(false);
  const read = useRef<ReadonlyMap<string, HhResumeContent>>(new Map());
  const snapshot = state.data ?? null;

  const { refreshing, settled, reread } = useSectionsRefresh(vacancyId, snapshot, replaceData);
  const pick = async (resumeId: string) => replaceData(await chooseHhResumeFor(vacancyId, resumeId));

  const openPicker = () => {
    setPicker({ kind: 'reading' });
    // Окно hh.ru одно: список читается после перечитывания выбранного.
    settled()
      .then(async (previous) => {
        const list = await readHhResumes();
        if (list.kind !== 'ready') return setPicker({ kind: list.kind === 'empty' ? 'empty' : 'signin' });
        const outcome = await reviewList(list.resumes, previous, vacancyId, options.pace);
        read.current = outcome.read;
        if (outcome.saved) replaceData(outcome.saved);
        return setPicker({ kind: 'choose', resumes: list.resumes, review: outcome.review });
      })
      .catch((reason: unknown) => setPicker(listFailure(reason)));
  };

  const choose = (item: HhResumeItem, onChosen?: () => void) => {
    if (picker.kind !== 'choose') return;
    const listed = picker.resumes.map(summaryOf);
    setSaving(true);
    // Прочитанное для сверки сервер хранит сам: выбор шлёт только выбранное резюме.
    saveChoice(vacancyId, listed, item, read.current.get(item.id))
      .then((saved) => {
        // Снимка до выбора могло не быть (GET вернул null): ставим его целиком.
        replaceData(saved);
        setPicker({ kind: 'closed' });
        onChosen?.();
      })
      .catch((reason: unknown) =>
        setPicker({ kind: 'error', text: apiErrorMessage(reason, 'Резюме не прочиталось. Выберите его ещё раз.') }),
      )
      .finally(() => setSaving(false));
  };

  return {
    snapshot,
    loading: state.status === 'loading' || refreshing,
    picker,
    openPicker,
    closePicker: () => setPicker({ kind: 'closed' }),
    signIn: () => void openHhSignIn(),
    saving,
    choose,
    pick,
    reread,
  };
}
