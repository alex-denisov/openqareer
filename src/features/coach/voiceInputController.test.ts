import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VoiceInputController,
  type VoiceInputControllerCallbacks,
} from './voiceInputController';
import type {
  LocalSpeechRecognition,
  SpeechRecognitionConstructor,
  SpeechRecognitionScope,
} from './localSpeechRecognition';

class FakeRecognition implements LocalSpeechRecognition {
  static startsWithLocalProcessing: boolean | null = null;
  processLocally = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: LocalSpeechRecognition['onstart'] = null;
  onresult: LocalSpeechRecognition['onresult'] = null;
  onerror: LocalSpeechRecognition['onerror'] = null;
  onend: LocalSpeechRecognition['onend'] = null;

  start() {
    FakeRecognition.startsWithLocalProcessing = this.processLocally;
    this.onstart?.();
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onend?.();
  }
}

const recognitionConstructor = FakeRecognition as unknown as SpeechRecognitionConstructor;
recognitionConstructor.available = vi.fn().mockResolvedValue('available');

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecognition.startsWithLocalProcessing = null;
});

describe('voice input controller lifecycle', () => {
  it('can start after the StrictMode setup-cleanup-setup cycle', async () => {
    const events = controllerCallbacks();
    vi.stubGlobal('window', browserWindow());
    const controller = new VoiceInputController(events.callbacks);

    controller.activate();
    controller.dispose();
    controller.activate();
    controller.request();
    controller.approve('');
    await vi.waitFor(() => expect(FakeRecognition.startsWithLocalProcessing).toBe(true));

    expect(events.states.at(-1)).toBe('recording');
    controller.dispose();
  });
});

function browserWindow(): SpeechRecognitionScope {
  return {
    SpeechRecognition: recognitionConstructor,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  } as unknown as SpeechRecognitionScope;
}

function controllerCallbacks() {
  const states: string[] = [];
  const callbacks: VoiceInputControllerCallbacks = {
    onState: (state) => states.push(state),
    onText: vi.fn(),
    onVoiceDraft: vi.fn(),
    onTextMode: vi.fn(),
    onElapsedSeconds: vi.fn(),
  };
  return { states, callbacks };
}
