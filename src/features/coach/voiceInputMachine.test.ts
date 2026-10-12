import { describe, expect, it } from 'vitest';
import { transitionVoiceInput, type VoiceInputEvent, type VoiceInputState } from './voiceInputMachine';

function transition(state: VoiceInputState, ...events: VoiceInputEvent[]): VoiceInputState {
  return events.reduce(transitionVoiceInput, state);
}

describe('voice input state machine', () => {
  it('requires explicit consent before starting local recognition', () => {
    expect(transition('idle', { type: 'request' })).toBe('consent');
    expect(transition('consent', { type: 'approve' })).toBe('starting');
    expect(transition('starting', { type: 'started' })).toBe('recording');
    expect(transition('idle', { type: 'started' })).toBe('idle');
  });

  it('keeps microphone refusal recoverable without starting a recording', () => {
    expect(transition('starting', { type: 'denied' })).toBe('denied');
    expect(transition('denied', { type: 'retry' })).toBe('consent');
  });

  it('retains a transcript for explicit review and send', () => {
    expect(
      transition('recording', { type: 'stop' }, { type: 'finished', hasTranscript: true }),
    ).toBe('transcribed');
    expect(transition('transcribed', { type: 'sent' })).toBe('idle');
  });

  it('offers retry when no speech was recognized', () => {
    expect(transition('recording', { type: 'stop' }, { type: 'finished', hasTranscript: false })).toBe(
      'unrecognized',
    );
    expect(transition('unrecognized', { type: 'retry' })).toBe('consent');
  });

  it('cancels and discards a recording without sending it', () => {
    expect(transition('recording', { type: 'cancel' })).toBe('idle');
    expect(transition('finishing', { type: 'cancel' })).toBe('idle');
  });

  it('never falls back to a remote recognizer when local speech support is absent', () => {
    expect(transition('starting', { type: 'unsupported' })).toBe('unsupported');
    expect(transition('unsupported', { type: 'retry' })).toBe('consent');
  });
});
