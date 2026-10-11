export type SpeechIssue = 'permission' | 'unrecognized' | 'unavailable';

export interface SpeechAlternative {
  readonly transcript: string;
}

export interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: SpeechAlternative;
}

export interface SpeechResultEvent extends Event {
  readonly results: ArrayLike<SpeechResult>;
}

export interface SpeechErrorEvent extends Event {
  readonly error: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function getBrowserSpeechRecognition(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const browser = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

export function speechIssueFromError(error: string): SpeechIssue {
  if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') {
    return 'permission';
  }
  if (error === 'no-speech') return 'unrecognized';
  return 'unavailable';
}
