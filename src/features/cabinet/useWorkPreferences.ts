import { useCallback, useEffect, useState } from 'react';
import {
  getWorkPreferences,
  submitWorkPreferences,
  type WorkPreferencesRead,
} from '../coach/coachApi';
import type { WorkFamilyCode, WorkPreferenceAnswer } from '../../../shared/workPreferences';

export interface WorkPreferencesState {
  readonly read: WorkPreferencesRead | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  submit(input: {
    readonly answers: readonly WorkPreferenceAnswer[];
    readonly excluded: readonly WorkFamilyCode[];
  }): Promise<boolean>;
}

/**
 * Читает задания «Какие роли мне подходят» и записывает ответы (B180, срез 3).
 *
 * Задания приходят с сервера вместе с версией ключа: держать формулировки в
 * интерфейсе значило бы менять смысл сохранённых ответов сменой слов.
 */
export function useWorkPreferences(provided?: WorkPreferencesState): WorkPreferencesState {
  const [read, setRead] = useState<WorkPreferencesRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (provided) return;
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
  }, [provided]);

  const submit = useCallback<WorkPreferencesState['submit']>(async (input) => {
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
  }, []);

  return provided ?? { read, loading, failed, saving, error, submit };
}
