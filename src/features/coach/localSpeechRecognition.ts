export const LOCAL_SPEECH_LANGUAGE = 'ru-RU';

export interface LocalSpeechResult {
  isFinal: boolean;
  0?: { transcript: string };
}

export interface LocalSpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<LocalSpeechResult>;
}

export interface LocalSpeechRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: LocalSpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionConstructor {
  new (): LocalSpeechRecognition;
  available?: (options: {
    langs: string[];
    processLocally: true;
    quality: 'dictation';
  }) => Promise<string>;
}

export interface SpeechRecognitionScope extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export type LocalSpeechFailure =
  | 'denied'
  | 'unrecognized'
  | 'unsupported'
  | 'cancelled'
  | 'error';

export async function createLocalSpeechRecognition(
  scope: SpeechRecognitionScope,
): Promise<LocalSpeechRecognition | null> {
  const Constructor = scope.SpeechRecognition;
  if (!Constructor?.available) return null;
  try {
    const availability = await Constructor.available({
      langs: [LOCAL_SPEECH_LANGUAGE],
      processLocally: true,
      quality: 'dictation',
    });
    if (availability !== 'available') return null;
    const recognition = new Constructor();
    if (!('processLocally' in recognition)) return null;
    recognition.processLocally = true;
    if (!recognition.processLocally) return null;
    recognition.lang = LOCAL_SPEECH_LANGUAGE;
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
  } catch {
    return null;
  }
}

export function combineSpeechResults(
  results: ArrayLike<LocalSpeechResult>,
  initialText: string,
): string {
  const transcripts = Array.from({ length: results.length }, (_, index) =>
    results[index]?.[0]?.transcript ?? '',
  );
  return [initialText, ...transcripts].join(' ').replace(/\s+/gu, ' ').trim();
}

export function mapLocalSpeechError(code: string): LocalSpeechFailure {
  if (code === 'not-allowed' || code === 'audio-capture') return 'denied';
  if (code === 'no-speech') return 'unrecognized';
  if (code === 'language-not-supported' || code === 'service-not-allowed') return 'unsupported';
  if (code === 'aborted') return 'cancelled';
  return 'error';
}
