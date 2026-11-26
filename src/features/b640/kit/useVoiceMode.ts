import { useCallback, useEffect, useState } from 'react';

export type ComposerMode = 'text' | 'voice';
const TOAST_MS = 4000;

export interface VoiceMode {
  readonly mode: ComposerMode;
  /** Показано «Нет доступа к микрофону». */
  readonly denied: boolean;
  readonly choose: (next: ComposerMode) => Promise<void>;
  readonly record: () => void;
}

/** Способ ввода: «Голосом» включается, только если `onVoice` не отказал. */
export function useVoiceMode(onVoice?: () => Promise<void>): VoiceMode {
  const [mode, setMode] = useState<ComposerMode>('text');
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!denied) return undefined;
    const timer = setTimeout(() => setDenied(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [denied]);

  const choose = useCallback(
    async (next: ComposerMode) => {
      if (next === 'text' || !onVoice) return setMode('text');
      try {
        await onVoice();
        setMode('voice');
      } catch {
        setMode('text');
        setDenied(true);
      }
    },
    [onVoice],
  );
  const record = useCallback(() => void onVoice?.().catch(() => setDenied(true)), [onVoice]);
  return { mode, denied, choose, record };
}
