import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  getBrowserSpeechRecognition,
  speechIssueFromError,
  type BrowserSpeechRecognition,
  type SpeechIssue,
} from './browserSpeechRecognition';

export type SpeechTranscriptionState = 'idle' | 'recording' | 'error';

export interface SpeechTranscription {
  readonly state: SpeechTranscriptionState;
  readonly issue: SpeechIssue | null;
  readonly transcript: string;
  readonly elapsedSeconds: number;
  readonly start: () => boolean;
  readonly stop: () => void;
  readonly reset: () => void;
}

interface SpeechStartOptions {
  readonly setState: Dispatch<SetStateAction<SpeechTranscriptionState>>;
  readonly setIssue: Dispatch<SetStateAction<SpeechIssue | null>>;
  readonly setTranscript: Dispatch<SetStateAction<string>>;
  readonly setElapsedSeconds: Dispatch<SetStateAction<number>>;
  readonly recognitionRef: React.MutableRefObject<BrowserSpeechRecognition | null>;
  readonly transcriptRef: React.MutableRefObject<string>;
  readonly issueRef: React.MutableRefObject<SpeechIssue | null>;
  readonly startedAtRef: React.MutableRefObject<number | null>;
}

function startRecognition(options: SpeechStartOptions): boolean {
  const Recognition = getBrowserSpeechRecognition();
  if (!Recognition) {
    options.setState('error');
    options.setIssue('unavailable');
    return false;
  }
  const recognition = new Recognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    const nextTranscript = readTranscript(event);
    options.transcriptRef.current = nextTranscript;
    options.setTranscript(nextTranscript);
  };
  recognition.onerror = (event) => {
    const issue = speechIssueFromError(event.error);
    options.issueRef.current = issue;
    options.setIssue(issue);
    options.setState('error');
  };
  recognition.onend = () => {
    if (options.transcriptRef.current.trim()) {
      options.setState('idle');
    } else {
      options.setIssue(options.issueRef.current ?? 'unrecognized');
      options.setState('error');
    }
  };
  options.recognitionRef.current = recognition;
  options.transcriptRef.current = '';
  options.setTranscript('');
  options.setElapsedSeconds(0);
  options.issueRef.current = null;
  options.setIssue(null);
  options.startedAtRef.current = Date.now();
  options.setState('recording');
  try {
    recognition.start();
    return true;
  } catch {
    abortSpeechRecognition(options.recognitionRef);
    options.setIssue('unavailable');
    options.setState('error');
    return false;
  }
}

export function useSpeechTranscription(): SpeechTranscription {
  const [state, setState] = useState<SpeechTranscriptionState>('idle');
  const [issue, setIssue] = useState<SpeechIssue | null>(null);
  const [transcript, setTranscript] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptRef = useRef('');
  const issueRef = useRef<SpeechIssue | null>(null);
  const startedAtRef = useRef<number | null>(null);
  useSpeechTimer(state, startedAtRef, setElapsedSeconds);
  useEffect(() => () => abortSpeechRecognition(recognitionRef), []);

  const start = useCallback(() => startRecognition({
    setState, setIssue, setTranscript, setElapsedSeconds, recognitionRef, transcriptRef, issueRef, startedAtRef,
  }), []);
  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    startedAtRef.current = null;
    setState('idle');
  }, []);
  const reset = useCallback(() => {
    abortSpeechRecognition(recognitionRef);
    startedAtRef.current = null;
    transcriptRef.current = '';
    issueRef.current = null;
    setTranscript('');
    setElapsedSeconds(0);
    setIssue(null);
    setState('idle');
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  return { state, issue, transcript, elapsedSeconds, start, stop, reset };
}

function abortSpeechRecognition(ref: React.MutableRefObject<BrowserSpeechRecognition | null>): void {
  const recognition = ref.current;
  if (!recognition) return;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  ref.current = null;
  recognition.abort();
}

function useSpeechTimer(
  state: SpeechTranscriptionState,
  startedAtRef: React.MutableRefObject<number | null>,
  setElapsedSeconds: Dispatch<SetStateAction<number>>,
) {
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const timer = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [state, startedAtRef, setElapsedSeconds]);
}

function readTranscript(event: Parameters<NonNullable<BrowserSpeechRecognition['onresult']>>[0]): string {
  return Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0].transcript ?? '')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}
