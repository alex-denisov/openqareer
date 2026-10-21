import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { getRelocationQuestionnaire, type RelocationQuestionnaireResponse } from './relocationApi';

export type RelocationProfileData = NonNullable<RelocationQuestionnaireResponse['profile']>;

export function useRelocationSnapshot() {
  const [snapshot, setSnapshot] = useState<RelocationQuestionnaireResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await getRelocationQuestionnaire(signal);
      if (signal?.aborted) return;
      setSnapshot(next);
    } catch (reason) {
      // A superseded load (unmount, remount) must not paint its abort over the next one.
      if (signal?.aborted) return;
      setError(apiErrorMessage(reason, 'Не удалось загрузить данные о релокации. Повторите запрос.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const updateProfile = useCallback((
    profile: NonNullable<RelocationQuestionnaireResponse['profile']>,
    alerts: RelocationQuestionnaireResponse['alerts'] = [],
  ) => {
    setSnapshot((current) => current ? { ...current, profile, alerts } : current);
  }, []);
  const updateConsent = useCallback((consent: RelocationQuestionnaireResponse['consent']) => {
    setSnapshot((current) => current ? { ...current, consent, profile: null } : current);
  }, []);
  const updateGrantedConsent = useCallback((consent: RelocationQuestionnaireResponse['consent']) => {
    setSnapshot((current) => (current ? { ...current, consent } : current));
  }, []);
  return { snapshot, error, loading, reload, updateProfile, updateConsent, updateGrantedConsent };
}
