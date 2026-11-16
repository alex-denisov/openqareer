import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechRecognitionScope } from '../../coach/localSpeechRecognition';
import { VoiceInputController } from '../../coach/voiceInputController';
import type { VoiceInputState } from '../../coach/voiceInputMachine';

const DENIED_TOAST_MS = 4000;
// Макет рисует один исход сбоя диктовки (K3b): строка о микрофоне и возврат к тексту.
const FAILED: readonly VoiceInputState[] = ['denied', 'unsupported', 'error'];

export interface Dictation {
  /** Браузер умеет распознавать речь: иначе способ «Голосом» не предлагается. */
  readonly supported: boolean;
  readonly recording: boolean;
  /** Диктовка остановлена, последние слова ещё дописываются в поле. */
  readonly settling: boolean;
  /** Показано «Нет доступа к микрофону». */
  readonly denied: boolean;
  /** Начать диктовку: сказанное дописывается к `currentText`. */
  readonly start: (currentText: string) => void;
  readonly stop: () => void;
}

function speechSupported(): boolean {
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
export function useDictation(onText: (text: string) => void, onFail: () => void): Dictation {
  const [supported] = useState(speechSupported);
  const [state, setState] = useState<VoiceInputState>('idle');
  const [denied, setDenied] = useState(false);
  const handlers = useRef({ onText, onFail });
  const controller = useRef<VoiceInputController | null>(null);

  useEffect(() => {
    handlers.current = { onText, onFail };
  }, [onText, onFail]);

  useEffect(() => {
    const created = new VoiceInputController({
      onState: (next) => {
        setState(next);
        if (!FAILED.includes(next)) return;
        setDenied(true);
        handlers.current.onFail();
      },
      onText: (text) => handlers.current.onText(text),
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
