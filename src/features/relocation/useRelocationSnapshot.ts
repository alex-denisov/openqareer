import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { getResumeStudio } from '../resume/resumeApi';
import type { ResumeDraft } from '../resume/resumeTypes';
import { getRelocationQuestionnaire, type RelocationQuestionnaireResponse } from './relocationApi';

export type RelocationProfileData = NonNullable<RelocationQuestionnaireResponse['profile']>;

/** The relocation answers plus the profile they are read from; null when the profile cannot be read. */
export type RelocationSnapshot = RelocationQuestionnaireResponse & {
  readonly profileDraft: ResumeDraft | null;
};

function loadWithProfile(signal?: AbortSignal) {
  return Promise.all([
    getRelocationQuestionnaire(signal),
    // Without the profile relocation still works from its own answers.
    getResumeStudio().catch(() => null),
  ]);
}

export function useRelocationSnapshot() {
  const [snapshot, setSnapshot] = useState<RelocationSnapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      const [next, resume] = await loadWithProfile(signal);
      if (signal?.aborted) return;
      setSnapshot({ ...next, profileDraft: resume?.draft ?? null });
    } catch (reason) {
      // A superseded load (unmount, remount) must not paint its abort over the next one.
      if (signal?.aborted) return;
      setError(
        apiErrorMessage(reason, 'Не удалось загрузить данные о релокации. Повторите запрос.'),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const updateProfile = useCallback(
    (
      profile: NonNullable<RelocationQuestionnaireResponse['profile']>,
      alerts: RelocationQuestionnaireResponse['alerts'] = [],
    ) => {
      setSnapshot((current) => (current ? { ...current, profile, alerts } : current));
    },
    [],
  );
  const updateConsent = useCallback((consent: RelocationQuestionnaireResponse['consent']) => {
    setSnapshot((current) => (current ? { ...current, consent, profile: null } : current));
  }, []);
  const updateGrantedConsent = useCallback(
    (consent: RelocationQuestionnaireResponse['consent']) => {
      setSnapshot((current) => (current ? { ...current, consent } : current));
    },
    [],
  );
  return { snapshot, error, loading, reload, updateProfile, updateConsent, updateGrantedConsent };
}
