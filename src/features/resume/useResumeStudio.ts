import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
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
export function useResumeStudio(onSaved?: () => void): ResumeStudioState {
  const { view, draft, loading, error, setView, setDraft, setLoading, load } = useResumeLoader();
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
        setView(next);
        setDraft(draftOf(next));
        onSaved?.();
        return true;
      } catch (reason) {
        setSaveError(
          errorMessage(
            reason,
            'Не удалось сохранить резюме. Проверьте связь с сервером; введённый текст остался в форме.',
          ),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [draft, onSaved],
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
      setError(
        errorMessage(
          reason,
          'Не удалось загрузить профиль. Проверьте соединение и повторите запрос.',
        ),
      );
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

function errorMessage(reason: unknown, fallback: string): string {
  return apiErrorMessage(reason, fallback);
}
