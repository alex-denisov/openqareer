import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDecisionProfile,
  getWorkPreferences,
  putDecisionProfile,
  submitWorkPreferences,
  type WorkPreferencesRead,
} from '../coach/coachApi';
import {
  DECISION_PROFILE_STORAGE_KEY,
  DECISION_PROFILE_SYNCED_KEY,
  DEFAULT_DECISION_PROFILE,
  isCandidateDecisionProfile,
  loadDecisionProfile,
  parseStoredDecisionProfile,
  saveDecisionProfile,
  type CandidateDecisionProfile,
  type WorkFamilyCode,
  type WorkPreferenceAnswer,
} from '../../../shared/workPreferences';
import { getStoredSessionToken } from '../coach/apiClient';

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
  sessionToken: string | null,
) {
  const [decisionProfile, setDecisionProfile] = useState<CandidateDecisionProfile>(() =>
    loadDecisionProfile(),
  );
  const [decisionProfileSaved, setDecisionProfileSaved] = useState(false);
  const attemptedSessionToken = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken || attemptedSessionToken.current === sessionToken) return;
    attemptedSessionToken.current = sessionToken;
    void syncDecisionProfile(setDecisionProfile, setDecisionProfileSaved);
  }, [sessionToken]);

  const saveProfile = useCallback<WorkPreferencesState['saveDecisionProfile']>(
    async (profile) => {
      setSaving(true);
      setError(null);
      try {
        const next = { ...profile, updatedAt: new Date().toISOString() };
        saveDecisionProfile(next);
        // Сервер применяет те же ограничения к подборке; при сбое остаётся локальная копия
        // и клиентский фильтр, поэтому сохранение не считается ошибкой.
        await persistDecisionProfile(next);
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

async function persistDecisionProfile(profile: CandidateDecisionProfile): Promise<void> {
  try {
    await putDecisionProfile(profile);
    markDecisionProfileSynced();
  } catch {
    // Без серверного подтверждения профиль останется только в localStorage.
  }
}

async function syncDecisionProfile(
  setDecisionProfile: (profile: CandidateDecisionProfile) => void,
  setDecisionProfileSaved: (saved: boolean) => void,
): Promise<void> {
  try {
    const serverProfile = await getDecisionProfile();
    if (serverProfile !== null) {
      if (!isCandidateDecisionProfile(serverProfile)) return;
      saveDecisionProfile(serverProfile);
      markDecisionProfileSynced();
      setDecisionProfile(serverProfile);
      setDecisionProfileSaved(true);
      return;
    }

    if (hasSyncedDecisionProfile()) return;
    const localProfile = readValidStoredDecisionProfile();
    if (!localProfile) return;
    await putDecisionProfile(localProfile);
    markDecisionProfileSynced();
    setDecisionProfile(localProfile);
    setDecisionProfileSaved(true);
  } catch {
    // Вход не блокируется: без метки профиль повторно синхронизируется при следующем входе.
  }
}

function readValidStoredDecisionProfile(): CandidateDecisionProfile | null {
  try {
    return parseStoredDecisionProfile(window.localStorage.getItem(DECISION_PROFILE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function hasSyncedDecisionProfile(): boolean {
  try {
    return window.localStorage.getItem(DECISION_PROFILE_SYNCED_KEY) === '1';
  } catch {
    return false;
  }
}

function markDecisionProfileSynced(): void {
  try {
    window.localStorage.setItem(DECISION_PROFILE_SYNCED_KEY, '1');
  } catch {
    // Без локального маркера повторная отправка останется безопасной: ручка делает upsert.
  }
}

/**
 * Читает задания «Какие роли мне подходят», сохраняет ответы
 * и управляет конфиденциальным профилем ограничений кандидата (US-03.3 / B384).
 */
export function useWorkPreferences(provided?: WorkPreferencesState): WorkPreferencesState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionToken = getStoredSessionToken();
  const { read, setRead, loading, failed } = usePreferencesTasks(Boolean(provided));
  const { decisionProfile, decisionProfileSaved, saveProfile, updateProfile, resetProfile } =
    useDecisionProfileManager(setSaving, setError, sessionToken);

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
