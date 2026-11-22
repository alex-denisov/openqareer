import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechRecognitionScope } from '../../coach/localSpeechRecognition';
import { VoiceInputController } from '../../coach/voiceInputController';
import type { VoiceInputState } from '../../coach/voiceInputMachine';
import type { ComposerDictation } from '../kit/Composer';

const DENIED_TOAST_MS = 4000;
// Макет рисует один исход сбоя диктовки (K3b): строка о микрофоне и возврат к тексту.
const FAILED: readonly VoiceInputState[] = ['denied', 'unsupported', 'error'];

export function speechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as SpeechRecognitionScope).SpeechRecognition?.available === 'function';
}

/** Строка о микрофоне гаснет сама через четыре секунды. */
function useExpiry(shown: boolean, setShown: (shown: boolean) => void): void {
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => setShown(false), DENIED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [shown, setShown]);
}

/** Диктовка в поле ввода: распознанный текст приходит в `onText` по мере речи. */
export function useDictation(onText: (text: string) => void): ComposerDictation {
  const [supported] = useState(speechSupported);
  const [state, setState] = useState<VoiceInputState>('idle');
  const [denied, setDenied] = useState(false);
  const handler = useRef(onText);
  const controller = useRef<VoiceInputController | null>(null);

  useEffect(() => {
    handler.current = onText;
  }, [onText]);

  useEffect(() => {
    const created = new VoiceInputController({
      onState: (next) => {
        setState(next);
        if (FAILED.includes(next)) setDenied(true);
      },
      onText: (text) => handler.current(text),
      onVoiceDraft: () => undefined,
      onTextMode: () => undefined,
      onElapsedSeconds: () => undefined,
    });
    created.activate();
    controller.current = created;
    return () => {
      created.dispose();
      controller.current = null;
    };
  }, []);

  useExpiry(denied, setDenied);

  const start = useCallback((currentText: string) => {
    const voice = controller.current;
    if (!voice) return;
    // Прошлая диктовка закончена или сорвалась: машина возвращается в начало, текст не трогает.
    voice.sent();
    voice.request();
    voice.approve(currentText);
  }, []);
  const stop = useCallback(() => controller.current?.finish(), []);

  return {
    supported,
    recording: state === 'starting' || state === 'recording',
    settling: state === 'finishing',
    denied,
    start,
    stop,
  };
}
