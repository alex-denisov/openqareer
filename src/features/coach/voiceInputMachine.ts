export type VoiceInputState =
  | 'idle'
  | 'consent'
  | 'starting'
  | 'recording'
  | 'finishing'
  | 'transcribed'
  | 'denied'
  | 'unrecognized'
  | 'unsupported'
  | 'error';

export type VoiceInputEvent =
  | { type: 'request' }
  | { type: 'approve' }
  | { type: 'started' }
  | { type: 'stop' }
  | { type: 'finished'; hasTranscript: boolean }
  | { type: 'denied' }
  | { type: 'unrecognized' }
  | { type: 'unsupported' }
  | { type: 'failed' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'sent' };

const transitions: Record<VoiceInputState, Partial<Record<VoiceInputEvent['type'], VoiceInputState>>> = {
  idle: { request: 'consent' },
  consent: { approve: 'starting', cancel: 'idle' },
  starting: {
    started: 'recording',
    denied: 'denied',
    unsupported: 'unsupported',
    failed: 'error',
    cancel: 'idle',
  },
  recording: {
    stop: 'finishing',
    denied: 'denied',
    unrecognized: 'unrecognized',
    unsupported: 'unsupported',
    failed: 'error',
    cancel: 'idle',
  },
  finishing: {
    denied: 'denied',
    unsupported: 'unsupported',
    failed: 'error',
    cancel: 'idle',
  },
  transcribed: { sent: 'idle', retry: 'consent', cancel: 'idle' },
  denied: { retry: 'consent', cancel: 'idle' },
  unrecognized: { retry: 'consent', cancel: 'idle' },
  unsupported: { retry: 'consent', cancel: 'idle' },
  error: { retry: 'consent', cancel: 'idle' },
};

export function transitionVoiceInput(
  state: VoiceInputState,
  event: VoiceInputEvent,
): VoiceInputState {
  if (event.type === 'cancel') return 'idle';
  if (event.type === 'finished' && (state === 'recording' || state === 'finishing')) {
    return event.hasTranscript ? 'transcribed' : 'unrecognized';
  }
  return transitions[state][event.type] ?? state;
}
