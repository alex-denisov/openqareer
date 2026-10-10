import {
  combineSpeechResults,
  createLocalSpeechRecognition,
  mapLocalSpeechError,
  type LocalSpeechFailure,
  type LocalSpeechRecognition,
  type LocalSpeechResultEvent,
  type SpeechRecognitionScope,
} from './localSpeechRecognition';
import {
  transitionVoiceInput,
  type VoiceInputEvent,
  type VoiceInputState,
} from './voiceInputMachine';

const MAX_RECORDING_SECONDS = 300;
type PendingAction = 'cancel' | 'restart' | 'finish' | 'text' | null;

export interface VoiceInputControllerCallbacks {
  onState: (state: VoiceInputState) => void;
  onText: (value: string) => void;
  onVoiceDraft: (hasDraft: boolean) => void;
  onTextMode: () => void;
  onElapsedSeconds: (seconds: number) => void;
}

export class VoiceInputController {
  private state: VoiceInputState = 'idle';
  private recognition: LocalSpeechRecognition | null = null;
  private pendingAction: PendingAction = null;
  private failure: LocalSpeechFailure | null = null;
  private initialText = '';
  private transcript = '';
  private nextInitialText: string | null = null;
  private startedAt: number | null = null;
  private timer: number | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly callbacks: VoiceInputControllerCallbacks) {}

  activate(): void {
    this.disposed = false;
  }

  request(): void {
    this.dispatch({ type: 'request' });
  }

  approve(currentText: string): void {
    this.dispatch({ type: 'approve' });
    const initialText = this.nextInitialText ?? currentText;
    this.nextInitialText = null;
    void this.start(initialText);
  }

  retry(): void {
    this.dispatch({ type: 'retry' });
  }

  finish(): void {
    if (!this.recognition) return;
    this.pendingAction = 'finish';
    this.clearTimer();
    this.dispatch({ type: 'stop' });
    this.recognition.stop();
  }

  cancel(): void {
    this.pendingAction = 'cancel';
    if (this.recognition) {
      this.clearTimer();
      this.dispatch({ type: 'stop' });
      this.recognition.abort();
      return;
    }
    this.invalidatePendingStart();
    this.callbacks.onText(this.initialText);
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'cancel' });
  }

  restart(): void {
    this.pendingAction = 'restart';
    if (this.recognition) {
      this.clearTimer();
      this.dispatch({ type: 'stop' });
      this.recognition.abort();
      return;
    }
    this.nextInitialText = this.initialText;
    this.callbacks.onText(this.initialText);
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'retry' });
  }

  useTextMode(): void {
    if (this.recognition) {
      this.pendingAction = 'text';
      this.clearTimer();
      this.dispatch({ type: 'stop' });
      this.recognition.abort();
      return;
    }
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'cancel' });
    this.callbacks.onTextMode();
  }

  sent(): void {
    this.callbacks.onVoiceDraft(false);
    this.dispatch(this.state === 'transcribed' ? { type: 'sent' } : { type: 'cancel' });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.pendingAction = 'cancel';
    this.clearTimer();
    this.recognition?.abort();
    this.recognition = null;
  }

  private async start(initialText: string): Promise<void> {
    const generation = ++this.generation;
    this.pendingAction = null;
    this.failure = null;
    this.initialText = initialText.trim();
    this.transcript = this.initialText;
    this.startedAt = null;
    this.callbacks.onElapsedSeconds(0);
    this.callbacks.onVoiceDraft(false);

    const recognition = await createLocalSpeechRecognition(window as SpeechRecognitionScope);
    if (this.disposed || generation !== this.generation) return;
    if (!recognition) return this.dispatch({ type: 'unsupported' });
    this.recognition = recognition;
    this.configureRecognition(recognition, generation);
    this.startBrowserRecognition(recognition);
  }

  private configureRecognition(recognition: LocalSpeechRecognition, generation: number): void {
    recognition.onstart = () => this.handleStart(recognition, generation);
    recognition.onresult = (event) => this.handleResult(recognition, generation, event.results);
    recognition.onerror = (event) => this.handleError(recognition, generation, event.error);
    recognition.onend = () => this.handleEnd(recognition, generation);
  }

  private handleStart(recognition: LocalSpeechRecognition, generation: number): void {
    if (!this.isCurrent(recognition, generation)) return;
    this.startedAt = Date.now();
    this.dispatch({ type: 'started' });
    this.startTimer();
  }

  private handleResult(
    recognition: LocalSpeechRecognition,
    generation: number,
    results: LocalSpeechResultEvent['results'],
  ): void {
    if (!this.isCurrent(recognition, generation)) return;
    this.transcript = combineSpeechResults(results, this.initialText);
    this.callbacks.onText(this.transcript);
    if (this.transcript.trim() !== this.initialText) this.callbacks.onVoiceDraft(true);
  }

  private handleError(
    recognition: LocalSpeechRecognition,
    generation: number,
    code: string,
  ): void {
    if (!this.isCurrent(recognition, generation)) return;
    const failure = mapLocalSpeechError(code);
    if (failure === 'cancelled' && this.pendingAction) return;
    this.failure = failure;
    this.dispatch(eventForFailure(failure));
    recognition.abort();
  }

  private handleEnd(recognition: LocalSpeechRecognition, generation: number): void {
    if (!this.isCurrent(recognition, generation)) return;
    this.recognition = null;
    this.startedAt = null;
    this.clearTimer();
    const action = this.pendingAction;
    this.pendingAction = null;
    if (this.failure) return;
    this.finishAction(action);
  }

  private finishAction(action: PendingAction): void {
    if (action === 'cancel') return this.cancelled();
    if (action === 'text') return this.switchToText();
    const hasTranscript = this.transcript.trim() !== this.initialText;
    if (hasTranscript) this.callbacks.onVoiceDraft(true);
    else this.callbacks.onText(this.initialText);
    this.dispatch({ type: 'finished', hasTranscript });
    if (action === 'restart') this.startAgain();
  }

  private cancelled(): void {
    this.callbacks.onText(this.initialText);
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'cancel' });
  }

  private switchToText(): void {
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'cancel' });
    this.callbacks.onTextMode();
  }

  private startAgain(): void {
    this.nextInitialText = this.initialText;
    this.callbacks.onText(this.initialText);
    this.callbacks.onVoiceDraft(false);
    this.dispatch({ type: 'cancel' });
    this.dispatch({ type: 'request' });
    this.approve(this.initialText);
  }

  private startTimer(): void {
    this.clearTimer();
    this.timer = window.setInterval(() => {
      if (this.startedAt === null) return;
      const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
      this.callbacks.onElapsedSeconds(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) this.finish();
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private startBrowserRecognition(recognition: LocalSpeechRecognition): void {
    try {
      recognition.start();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : 'error';
      this.failure = mapLocalSpeechError(name === 'NotAllowedError' ? 'not-allowed' : name);
      this.dispatch(eventForFailure(this.failure));
      recognition.abort();
    }
  }

  private invalidatePendingStart(): void {
    this.generation += 1;
    this.clearTimer();
  }

  private isCurrent(recognition: LocalSpeechRecognition, generation: number): boolean {
    return !this.disposed && this.recognition === recognition && this.generation === generation;
  }

  private dispatch(event: VoiceInputEvent): void {
    this.state = transitionVoiceInput(this.state, event);
    this.callbacks.onState(this.state);
  }
}

function eventForFailure(failure: LocalSpeechFailure): VoiceInputEvent {
  if (failure === 'denied') return { type: 'denied' };
  if (failure === 'unrecognized') return { type: 'unrecognized' };
  if (failure === 'unsupported') return { type: 'unsupported' };
  if (failure === 'cancelled') return { type: 'cancel' };
  return { type: 'failed' };
}
