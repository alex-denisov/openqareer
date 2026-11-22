import { useEffect, useState } from 'react';
import { getSession } from '../../coach/coachApi';

/**
 * B642: запись разговоров включается флагом сервера вместе с редакцией 1.3 юридических
 * документов. Ответ `/auth/me` читается один раз на страницу.
 */
let pending: Promise<boolean> | null = null;

export function interviewRecordingEnabled(): Promise<boolean> {
  pending ??= getSession()
    .then((session) => session?.features?.interviewRecording === true)
    .catch(() => {
      pending = null;
      return false;
    });
  return pending;
}

/** `null` — ещё не известно. */
export function useInterviewRecording(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void interviewRecordingEnabled().then((value) => alive && setEnabled(value));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** Для тестов: забыть прочитанный флаг. */
export function resetInterviewRecordingFeature(): void {
  pending = null;
}
