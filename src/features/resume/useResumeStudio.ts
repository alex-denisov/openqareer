import { useCallback, useEffect, useState } from 'react';
import { CoachApiError } from '../coach/apiClient';
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
  readonly save: () => void;
}

/**
 * Owns the unsaved draft. Saving is deliberately manual: a `PUT` also approves
 * the evidence snapshot the documents were built from, so autosaving would
 * quietly stand behind facts on the candidate's behalf.
 */
export function useResumeStudio(onSaved?: () => void): ResumeStudioState {
  const { view, draft, loading, error, setView, setDraft, setLoading, load } =
    useResumeLoader();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const next = await saveResumeStudioDraft(toSavePayload(draft));
      setView(next);
      setDraft(draftOf(next));
      onSaved?.();
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

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
    save: () => void save(),
  };
}

function useResumeLoader() {
  const [view, setView] = useState<ResumeStudioView>();
  const [draft, setDraft] = useState<ResumeDraft>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const next = await getResumeStudio();
      setView(next);
      setDraft(draftOf(next));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  return { view, draft, loading, error, setView, setDraft, setLoading, load };
}

function errorMessage(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) return reason.message;
  return 'Не удалось загрузить резюме. Повторите запрос.';
}
