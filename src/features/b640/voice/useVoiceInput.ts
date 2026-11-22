import { useCallback, useEffect, useRef, useState } from 'react';
import { speechSupported, useDictation } from '../consultant/useDictation';
import {
  canRecordInApp,
  recordingPermissions,
  requestRecordingPermissions,
  type CreatedRecording,
} from '../interview/data/recordingBridge';
import type { ComposerDictation } from '../kit/Composer';
import { beginAppDictation, finishAppDictation } from './appDictation';
import { interviewRecordingEnabled } from './recordingFeature';

/** `mic` — нет доступа к микрофону; `speech` — запись не распознана. */
export type VoiceFailure = 'mic' | 'speech' | null;

export interface VoiceInput extends ComposerDictation {
  readonly failure: VoiceFailure;
}

type AppPhase = 'idle' | 'listening' | 'transcribing';

/**
 * Запись .app пока берёт и звук компьютера, и доступ к экрану; для диктовки это не годится
 * (решение 22.11). Включается, когда режим «только микрофон» B758 (#930) в main.
 */
export const APP_MIC_ONLY_READY = false;

const joined = (base: string, text: string) => [base.trimEnd(), text].filter(Boolean).join(' ');

function useAppSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!APP_MIC_ONLY_READY || !canRecordInApp()) return undefined;
    let alive = true;
    // Диктовка в .app идёт через запись B642: нет записи на сервере — нет и голоса.
    void interviewRecordingEnabled()
      .then(async (on) => on && (await recordingPermissions()).supported)
      .then((found) => alive && setSupported(found))
      .catch(() => alive && setSupported(false));
    return () => {
      alive = false;
    };
  }, []);
  return supported;
}

/** Диктовка в .app: запись с микрофона, текст приходит после «Стоп» (решение 22.11). */
function useAppDictation(onText: (text: string) => void): VoiceInput {
  const supported = useAppSupport();
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [failure, setFailure] = useState<VoiceFailure>(null);
  const current = useRef<{ created: CreatedRecording; base: string } | null>(null);
  const aborter = useRef(new AbortController());
  useEffect(() => () => aborter.current.abort(), []);

  const start = useCallback(async (currentText: string) => {
    setFailure(null);
    try {
      if (!(await requestRecordingPermissions()).microphone) throw new Error('microphone');
      current.current = { created: await beginAppDictation(), base: currentText };
      setPhase('listening');
    } catch {
      setFailure('mic');
      setPhase('idle');
    }
  }, []);

  const stop = useCallback(async () => {
    const taken = current.current;
    current.current = null;
    if (!taken) return;
    setPhase('transcribing');
    try {
      const text = await finishAppDictation(taken.created.recordingId, aborter.current.signal);
      onText(joined(taken.base, text));
    } catch {
      if (!aborter.current.signal.aborted) setFailure('speech');
    } finally {
      if (!aborter.current.signal.aborted) setPhase('idle');
    }
  }, [onText]);

  return {
    supported,
    recording: phase === 'listening',
    settling: phase === 'transcribing',
    denied: failure === 'mic',
    failure,
    start: (text) => void start(text),
    stop: () => void stop(),
  };
}

/**
 * Голосовой ввод ответа для i02 и i03 (общий с A2): браузер распознаёт речь сам, в .app
 * без распознавания — запись B642 и расшифровка на сервере. Форма — как у `useDictation`.
 */
export function useVoiceInput(onText: (text: string) => void): VoiceInput {
  const [browser] = useState(speechSupported);
  const dictation = useDictation(onText);
  const app = useAppDictation(onText);
  if (browser) return { ...dictation, failure: dictation.denied ? 'mic' : null };
  return app;
}
