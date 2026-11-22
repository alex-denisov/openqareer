import { useEffect, useState } from 'react';
import {
  onRecordingState,
  recordingPermissions,
  requestRecordingPermissions,
  resumeRecording,
  startErrorText,
  startRecording,
  stopRecording,
  type CreatedRecording,
} from './data/recordingBridge';

export type AppRecordingPhase =
  | 'checking'
  | 'unsupported'
  | 'ready'
  | 'starting'
  | 'recording'
  | 'stopped'
  | 'finishing'
  | 'done';

export interface AppRecording {
  readonly phase: AppRecordingPhase;
  readonly elapsedMs: number;
  readonly error: string | null;
  readonly start: () => Promise<void>;
  /** После сбоя: продолжить ту же запись. */
  readonly resume: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

function useSupport(setPhase: (phase: AppRecordingPhase) => void) {
  useEffect(() => {
    let alive = true;
    void recordingPermissions().then((permissions) => {
      if (alive) setPhase(permissions.supported ? 'ready' : 'unsupported');
    });
    return () => {
      alive = false;
    };
  }, [setPhase]);
}

function useStateEvents(
  setElapsed: (ms: number) => void,
  setPhase: (phase: AppRecordingPhase) => void,
) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    void onRecordingState((event) => {
      setElapsed(event.elapsedMs);
      if (event.state === 'error') setPhase('stopped');
      if (event.state === 'recording') setPhase('recording');
    }).then((off) => {
      if (alive) unlisten = off;
      else off();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [setElapsed, setPhase]);
}

/** Разрешения, затем запись на сервере и старт в .app; ошибка — код из контракта D2. */
async function beginRecording(
  applicationId: string,
  interviewId: string | null,
): Promise<CreatedRecording> {
  if (!interviewId) throw new Error('no_interview');
  const permissions = await requestRecordingPermissions();
  if (!permissions.microphone) throw new Error('microphone_permission');
  if (!permissions.screen) throw new Error('screen_permission');
  return startRecording(applicationId, interviewId);
}

function nextPart(
  applicationId: string,
  interviewId: string | null,
  previous: CreatedRecording | null,
): Promise<CreatedRecording> {
  if (!previous || !interviewId) return Promise.reject(new Error('no_interview'));
  return resumeRecording(applicationId, interviewId, previous);
}

/** Запись интервью в .app (I4b): разрешения, старт, индикатор, сбой с продолжением, итог. */
export function useAppRecording(applicationId: string, interviewId: string | null): AppRecording {
  const [phase, setPhase] = useState<AppRecordingPhase>('checking');
  const [elapsedMs, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedRecording | null>(null);
  useSupport(setPhase);
  useStateEvents(setElapsed, setPhase);

  async function guarded(
    next: AppRecordingPhase,
    work: () => Promise<void>,
    back: AppRecordingPhase,
  ) {
    setError(null);
    setPhase(next);
    try {
      await work();
    } catch (reason) {
      setError(startErrorText(reason));
      setPhase(back);
    }
  }
  const start = () =>
    guarded(
      'starting',
      async () => {
        setCreated(await beginRecording(applicationId, interviewId));
        setPhase('recording');
      },
      'ready',
    );
  const resume = () =>
    guarded(
      'starting',
      async () => {
        setCreated(await nextPart(applicationId, interviewId, created));
        setPhase('recording');
      },
      'stopped',
    );
  const stop = () =>
    guarded(
      'finishing',
      async () => {
        if (created) await stopRecording(created.recordingId);
        setPhase('done');
      },
      'stopped',
    );
  return { phase, elapsedMs, error, start, resume, stop };
}
