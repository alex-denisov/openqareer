import { useCallback, useEffect, useState } from 'react';
import {
  getWorkPreferences,
  putDecisionProfile,
  submitWorkPreferences,
  type WorkPreferencesRead,
} from '../coach/coachApi';
import {
  DEFAULT_DECISION_PROFILE,
  loadDecisionProfile,
  saveDecisionProfile,
  type CandidateDecisionProfile,
  type WorkFamilyCode,
  type WorkPreferenceAnswer,
} from '../../../shared/workPreferences';

export interface WorkPreferencesState {
  readonly read: WorkPreferencesRead | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly decisionProfile: CandidateDecisionProfile;
  readonly decisionProfileSaved: boolean;
  submit(input: {
    readonly answers: readonly WorkPreferenceAnswer[];
    readonly excluded: readonly WorkFamilyCode[];
  }): Promise<boolean>;
  saveDecisionProfile(profile: CandidateDecisionProfile): Promise<boolean>;
  updateDecisionProfile(patch: Partial<CandidateDecisionProfile>): Promise<boolean>;
  resetDecisionProfile(): Promise<boolean>;
}

function usePreferencesTasks(skip: boolean) {
  const [read, setRead] = useState<WorkPreferencesRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (skip) return;
    const controller = new AbortController();
    let active = true;
    getWorkPreferences(controller.signal)
      .then((next) => {
        if (active) setRead(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [skip]);

  return { read, setRead, loading, failed };
}

function useDecisionProfileManager(
  setSaving: (saving: boolean) => void,
  setError: (error: string | null) => void,
) {
  const [decisionProfile, setDecisionProfile] = useState<CandidateDecisionProfile>(() =>
    loadDecisionProfile(),
  );
  const [decisionProfileSaved, setDecisionProfileSaved] = useState(false);

  const saveProfile = useCallback<WorkPreferencesState['saveDecisionProfile']>(
    async (profile) => {
      setSaving(true);
      setError(null);
      try {
        const next = { ...profile, updatedAt: new Date().toISOString() };
        saveDecisionProfile(next);
        // Сервер применяет те же ограничения к подборке; при сбое остаётся локальная копия
        // и клиентский фильтр, поэтому сохранение не считается ошибкой.
        await putDecisionProfile(next).catch(() => undefined);
        setDecisionProfile(next);
        setDecisionProfileSaved(true);
        return true;
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : 'Не удалось сохранить профиль ограничений.',
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setError],
  );

  const updateProfile = useCallback<WorkPreferencesState['updateDecisionProfile']>(
    async (patch) => saveProfile({ ...decisionProfile, ...patch }),
    [decisionProfile, saveProfile],
  );

  const resetProfile = useCallback<WorkPreferencesState['resetDecisionProfile']>(
    async () => saveProfile(DEFAULT_DECISION_PROFILE),
    [saveProfile],
  );

  return { decisionProfile, decisionProfileSaved, saveProfile, updateProfile, resetProfile };
}

/**
 * Читает задания «Какие роли мне подходят», сохраняет ответы
 * и управляет конфиденциальным профилем ограничений кандидата (US-03.3 / B384).
 */
export function useWorkPreferences(provided?: WorkPreferencesState): WorkPreferencesState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { read, setRead, loading, failed } = usePreferencesTasks(Boolean(provided));
  const { decisionProfile, decisionProfileSaved, saveProfile, updateProfile, resetProfile } =
    useDecisionProfileManager(setSaving, setError);

  const submit = useCallback<WorkPreferencesState['submit']>(
    async (input) => {
      setSaving(true);
      setError(null);
      try {
        const run = await submitWorkPreferences(input);
        setRead((current) => (current ? { ...current, run } : current));
        return true;
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : 'Ответы не сохранились. Попробуйте ещё раз.',
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [setRead],
  );

  return (
    provided ?? {
      read,
      loading,
      failed,
      saving,
      error,
      decisionProfile,
      decisionProfileSaved,
      submit,
      saveDecisionProfile: saveProfile,
      updateDecisionProfile: updateProfile,
      resetDecisionProfile: resetProfile,
    }
  );
}

