import { useCallback, useEffect, useRef, useState } from 'react';
import { useLetterApproval, type LetterApprovalState } from '../../vacancies/vacancyLetterApproval';
import {
  readStoredLetter,
  type StoredLetterApproval,
  type StoredLetterDraft,
} from '../../vacancies/vacancyLetterApi';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { useAsync } from '../responses/data/useAsync';
import { approvalPitch } from './model/variantModel';
import { useLetterDraftSave, type LetterDraftSave } from './useLetterDraftSave';
import type { LetterVariantsState } from './useLetterVariants';

/** Текст, с которым открывается экран: правка до одобрения или одобренное письмо. */
type StoredText = StoredLetterApproval | StoredLetterDraft;

/** Одобрение на сервере и придержанный черновик письма. */
export interface ApprovalHold {
  /** Последнее одобрение вакансии (B711); `null` — не одобряли или ещё не прочитано. */
  readonly stored: StoredLetterApproval | null;
  /** Правка, которую не успели одобрить; `null` — её нет. */
  readonly draft: StoredLetterDraft | null;
  /** Черновик не просим: одобрение ещё читается или письмо одобрено и не снято «Изменить». */
  readonly hold: boolean;
  /** Черновик просили вместо сохранённого текста: пришедшее письмо встаёт в поле. */
  readonly rebuilding: boolean;
  /** «Изменить»: одобрение снято, черновик снова нужен для нового одобрения. */
  readonly release: (rebuild: boolean) => void;
  /** «Вернуть прежний»: в поле снова одобренное письмо. */
  readonly back: () => void;
}

/**
 * Одобренное письмо открывается своим текстом сразу после чтения одобрения: модель не пишет
 * черновик, который всё равно заменит одобренный текст (было 10–15 с «Собираем письмо…»).
 * Правку до одобрения открываем как правку; если её числа опровергнуты — ждём пересборки.
 */
export function useApprovalHold(vacancyId: string): ApprovalHold {
  const load = useCallback(
    (signal: AbortSignal) => readStoredLetter(vacancyId, signal),
    [vacancyId],
  );
  const { state } = useAsync(load, '');
  const [mode, setMode] = useState<'stored' | 'approved' | 'editing' | 'rebuilding'>('stored');
  const stored = state.data?.approval ?? null;
  const draft = (mode === 'approved' ? null : state.data?.draft) ?? null;
  const checked = state.status !== 'loading';
  const editing = mode === 'editing' || mode === 'rebuilding';
  const held = draft ? draft.factsChanged === true : stored !== null;
  return {
    stored,
    draft,
    hold: !checked || (held && !editing),
    rebuilding: mode === 'rebuilding',
    release: useCallback((rebuild) => setMode(rebuild ? 'rebuilding' : 'editing'), []),
    back: useCallback(() => setMode('approved'), []),
  };
}

/**
 * Сохранённый на сервере текст (B711) встаёт в поле, когда прочитаны варианты. Черновик при этом
 * придержан; если его всё же просили (B716), ждём, пока он соберётся, —
 * иначе пришедшее письмо перезаписало бы этот текст. Правка встаёт сразу: её бережёт следующий хук.
 */
function useRestoredText(
  approvalHold: ApprovalHold,
  letter: LetterScreenState,
  variants: LetterVariantsState,
): StoredText | null {
  const { stored, draft, hold } = approvalHold;
  const text = draft ?? stored;
  const [applied, setApplied] = useState<StoredText | null>(null);
  const { pitch, loading, error } = letter.draft;
  const draftSettled = !loading && (pitch !== null || error !== '');
  const { settled: variantsSettled, restore } = variants;
  const ready = hold || draft !== null || draftSettled;
  useEffect(() => {
    if (!text || applied === text || !variantsSettled || !ready) return;
    restore(text.variantId, text.body);
    setApplied(text);
  }, [text, applied, ready, variantsSettled, restore]);
  return applied;
}

/**
 * После «Изменить» черновик просится заново, а текст в поле — одобренный, возможно уже
 * исправленный. Первый пришедший черновик его не заменяет: возвращаем текст, что был в поле до него.
 * Дальше (тон, язык, адресат, пересборка по новым фактам) в поле встаёт собранное письмо.
 * Возвращает, бережём ли сейчас текст поля.
 */
function useKeptTextAfterRelease(
  applied: StoredText | null,
  approvalHold: ApprovalHold,
  letter: LetterScreenState,
  restore: LetterVariantsState['restore'],
  onReplaced: () => void,
): boolean {
  const { pitch, text } = letter.draft;
  const settings = [letter.tone, letter.language, letter.circle.selectedPathId ?? ''].join('|');
  const keeping = applied !== null && !approvalHold.hold && !approvalHold.rebuilding;
  /** Настройки, с которыми текст открыли для правки; `null` — беречь нечего. */
  const [base, setBase] = useState<string | null>(null);
  const kept = useRef<string | null>(null);
  const seen = useRef<unknown>(null);
  useEffect(() => {
    setBase(keeping ? settings : null);
    kept.current = null;
    // Черновик пришёл раньше сохранённого текста: он уже заменён им и ничего не заменяет сам.
    if (keeping) seen.current = pitch;
    // Настройки и черновик берём на момент перехода.
  }, [keeping]);
  useEffect(() => {
    if (pitch === null) {
      kept.current = base === null ? null : text;
      seen.current = null;
      return;
    }
    if (seen.current === pitch) return;
    seen.current = pitch;
    const own = kept.current;
    kept.current = null;
    setBase(null);
    if (own !== null && base === settings) restore(applied!.variantId, own);
    else onReplaced();
  }, [pitch, text, settings, base, applied, restore, onReplaced]);
  return base !== null && base === settings && pitch === null;
}

/** Другая вкладка могла исправить профиль: вернулись в окно — сверяем одобренное письмо заново. */
function useFactsRecheck(
  vacancyId: string,
  documentId: string | null,
): StoredLetterApproval | null {
  const [latest, setLatest] = useState<StoredLetterApproval | null>(null);
  useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    const check = () => {
      readStoredLetter(vacancyId, controller.signal)
        .then(({ approval }) => setLatest(approval))
        // Сверка повторится при следующем возврате в окно; сервер сверит и при одобрении.
        .catch(() => undefined);
    };
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('focus', check);
      controller.abort();
    };
  }, [vacancyId, documentId]);
  return latest;
}

/** Правка кандидата в поле: текст меняется сразу, на сервер уходит после паузы. */
function useEditedDraft(
  letter: LetterScreenState,
  variants: LetterVariantsState,
  save: LetterDraftSave,
): LetterScreenState['draft'] {
  const { setText, pitch } = letter.draft;
  const { selectedId } = variants;
  const { edit } = save;
  const profileHash = pitch?.profileHash;
  const setEdited = useCallback(
    (text: string) => {
      setText(text);
      edit({
        body: text.trim(),
        ...(selectedId ? { variantId: selectedId } : {}),
        ...(profileHash ? { profileHash } : {}),
      });
    },
    [setText, edit, selectedId, profileHash],
  );
  return { ...letter.draft, setText: setEdited };
}

/** «Изменить», «Пересобрать» и «Вернуть прежний». */
function useReopen(
  approvalHold: ApprovalHold,
  letter: LetterScreenState,
  variants: LetterVariantsState,
  approval: LetterApprovalState,
  discard: LetterDraftSave['discard'],
) {
  const { stored, hold, release, back } = approvalHold;
  const { reset, keep } = approval;
  const { retry } = letter.draft;
  const { restore } = variants;
  const reopen = useCallback(
    (rebuild: boolean) => {
      reset();
      release(rebuild);
      // Одобрили здесь же, черновик уже не придержан: новый просим сами.
      if (rebuild && !hold) retry();
    },
    [reset, release, hold, retry],
  );
  const revert = useCallback(() => {
    if (!stored) return;
    void discard().then(() => {
      restore(stored.variantId, stored.body);
      keep(stored);
      back();
    });
  }, [stored, discard, restore, keep, back]);
  return { reopen, revert };
}

/** Правка досохраняется до одобрения: отказ одобрения её не теряет. */
function useSavedFirst(
  { approve, attachGeneralResume }: LetterApprovalState,
  settle: LetterDraftSave['settle'],
) {
  return {
    approve: useCallback(() => settle().then(approve), [settle, approve]),
    attachGeneralResume: useCallback(
      () => settle().then(attachGeneralResume),
      [settle, attachGeneralResume],
    ),
  };
}

/** Одобренный текст есть и годен. Одобрили здесь же — прочитанное при открытии уже не последнее. */
function useRevertable(stored: StoredLetterApproval | null, savedId: string | undefined): boolean {
  const [approvedHere, setApprovedHere] = useState(false);
  const storedId = stored?.documentId;
  useEffect(() => {
    if (savedId && savedId !== storedId) setApprovedHere(true);
  }, [savedId, storedId]);
  return stored !== null && !stored.factsChanged && !approvedHere;
}

/** Свежесть показанного одобрения: последняя сверка или то, что прочитали при открытии. */
function useShownFreshness(
  vacancyId: string,
  savedId: string | undefined,
  restored: StoredLetterApproval | null,
): StoredLetterApproval | null {
  const latest = useFactsRecheck(vacancyId, savedId ?? null);
  if (!savedId) return null;
  return [latest, restored].find((item) => item?.documentId === savedId) ?? null;
}

function approvalInput(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
  restored: StoredLetterApproval | null,
): Parameters<typeof useLetterApproval>[0] {
  return {
    vacancyId,
    circle: letter.circle.circle,
    language: letter.language,
    tone: letter.tone,
    path: letter.circle.selectedPath,
    pitch: approvalPitch(letter.draft.pitch, variants.selected),
    body: letter.draft.text,
    includedWorkplaceIds: letter.draft.workplaces.map((workplace) => workplace.id),
    onResumeChanged: letter.draft.retry,
    variantId: variants.selectedId,
    restored,
  };
}

/**
 * Одобрение письма с учётом выбранного варианта (B682): в снимок уходят тема и факты профиля
 * того текста, который кандидат одобряет, а не первого письма.
 */
export function useVariantApproval(
  vacancyId: string,
  letter: LetterScreenState,
  variants: LetterVariantsState,
  approvalHold: ApprovalHold,
): LetterScreenState {
  const { stored, draft, hold } = approvalHold;
  const save = useLetterDraftSave(vacancyId, draft !== null);
  const { discard, settle } = save;
  const applied = useRestoredText(approvalHold, letter, variants);
  const restored = stored && applied === stored ? stored : null;
  // Новое письмо заменило правку. Правка, ещё не вставшая в поле, письмом не заменена.
  const dropDraft = useCallback(() => {
    if (draft === null || applied === draft) void discard();
  }, [discard, draft, applied]);
  const keepsText = useKeptTextAfterRelease(
    applied,
    approvalHold,
    letter,
    variants.restore,
    dropDraft,
  );
  const approval = useLetterApproval(approvalInput(vacancyId, letter, variants, restored));
  const { saved } = approval;
  const shown = useShownFreshness(vacancyId, saved?.documentId, restored);
  // Правка с опровергнутым числом ждёт пересборки так же, как одобренное письмо.
  const stale = saved ? shown?.factsChanged === true : hold && draft?.factsChanged === true;
  const { reopen, revert } = useReopen(approvalHold, letter, variants, approval, discard);
  const canRevert =
    useRevertable(stored, saved?.documentId) && !saved && !stale && !hold && applied !== null;
  const snapshot = saved && restored?.documentId === saved.documentId ? restored : null;

  return {
    ...letter,
    // B645: после перезагрузки черновика нет — язык и тон одобренного письма берутся из снимка.
    language: snapshot?.language ?? letter.language,
    tone: snapshot?.tone ?? letter.tone,
    draft: useEditedDraft(letter, variants, save),
    approval: {
      ...approval,
      saved: stale ? null : saved,
      stale,
      keepsText,
      ...useSavedFirst(approval, settle),
      reset: useCallback(
        () => reopen(shown?.profileChanged === true),
        [reopen, shown?.profileChanged],
      ),
      rebuild: useCallback(() => reopen(true), [reopen]),
      ...(canRevert ? { revert } : {}),
      ...(save.failed ? { retryDraftSave: save.retry } : {}),
    },
  };
}
