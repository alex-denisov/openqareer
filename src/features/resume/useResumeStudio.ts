import { useCallback, useEffect, useRef, useState } from 'react';
import { SECTION_CACHE_KEYS, readSectionCache, writeSectionCache } from '../shell/sectionCache';
import { profileFailureText } from './profileFailureText';
import { getResumeStudio, saveResumeStudioDraft } from './resumeApi';
import { draftOf, toSavePayload } from './resumeStudioModel';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';

export interface ResumeStudioState {
  readonly view?: ResumeStudioView;
  readonly draft?: ResumeDraft;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error?: string;
  readonly saveError?: string;
  readonly setDraft: (draft: ResumeDraft) => void;
  readonly reload: () => void;
  /**
   * Saves the draft in hand, or `overrideDraft` when the caller just computed
   * a new draft in the same tick and cannot wait for `setDraft` to land
   * before saving it (e.g. a section's own "Сохранить" — B265 owner remark
   * #5) — `setDraft` and `save` would otherwise race against React's async
   * state update and save the value from before the edit.
   */
  readonly save: (overrideDraft?: ResumeDraft) => Promise<boolean>;
}

/**
 * Owns the unsaved draft. Saving is deliberately manual: a `PUT` also approves
 * the evidence snapshot the documents were built from, so autosaving would
 * quietly stand behind facts on the candidate's behalf.
 */
export function useResumeStudio(onSaved?: () => void, refreshKey?: number): ResumeStudioState {
  const { view, draft, loading, error, applyRead, setDraft, setLoading, load } =
    useResumeLoader(refreshKey);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const save = useCallback(
    async (overrideDraft?: ResumeDraft): Promise<boolean> => {
      const toSave = overrideDraft ?? draft;
      if (!toSave) return false;
      setSaving(true);
      setSaveError(undefined);
      try {
        const next = await saveResumeStudioDraft(toSavePayload(toSave));
        applyRead(next);
        onSaved?.();
        return true;
      } catch (reason) {
        setSaveError(
profileFailureText(reason, 'save')
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [applyRead, draft, onSaved],
  );

  return {
    view,
    draft,
    loading,
    saving,
    error,
    saveError,
    setDraft,
    reload: () => {
      setLoading(true);
      void load();
    },
    save,
  };
}

/**
 * B589: the profile opens from the last reading and the read below refreshes
 * it in the background. The refresh after a cached start must not throw away
 * an edit the candidate began on the cached draft, and a read that answers
 * after a newer reading or save is dropped.
 */
function useResumeViewState() {
  const [view, setView] = useState<ResumeStudioView | undefined>(() =>
    readSectionCache<ResumeStudioView>(SECTION_CACHE_KEYS.resumeStudio),
  );
  const [draft, setDraftState] = useState<ResumeDraft | undefined>(() =>
    view ? draftOf(view) : undefined,
  );
  const awaitingFirstRead = useRef(view !== undefined);
  const cachedDraftEdited = useRef(false);
  const viewRevision = useRef(0);
  const setDraft = useCallback((next: ResumeDraft) => {
    if (awaitingFirstRead.current) cachedDraftEdited.current = true;
    setDraftState(next);
  }, []);
  const applyRead = useCallback((next: ResumeStudioView) => {
    viewRevision.current += 1;
    awaitingFirstRead.current = false;
    setView(next);
    setDraftState(draftOf(next));
  }, []);
  const applyBackgroundRead = useCallback(
    (next: ResumeStudioView, startedAt: number) => {
      if (startedAt !== viewRevision.current) return;
      if (!awaitingFirstRead.current || !cachedDraftEdited.current) {
        applyRead(next);
        return;
      }
      viewRevision.current += 1;
      awaitingFirstRead.current = false;
      setView(next);
    },
    [applyRead],
  );
  useEffect(() => {
    if (view) writeSectionCache(SECTION_CACHE_KEYS.resumeStudio, view);
  }, [view]);
  return { view, draft, setDraft, applyRead, applyBackgroundRead, viewRevision };
}

function useResumeLoader(refreshKey?: number) {
  const { view, draft, setDraft, applyRead, applyBackgroundRead, viewRevision } =
    useResumeViewState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const startedAt = viewRevision.current;
      applyBackgroundRead(await getResumeStudio(), startedAt);
    } catch (reason) {
      setError(
profileFailureText(reason, 'load')
      );
    } finally {
      setLoading(false);
    }
  }, [applyBackgroundRead, viewRevision]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  return { view, draft, loading, error, applyRead, setDraft, setLoading, load };
}
