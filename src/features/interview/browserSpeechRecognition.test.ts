import { describe, expect, it } from 'vitest';
import { speechIssueFromError } from './browserSpeechRecognition';

describe('speechIssueFromError', () => {
  it('distinguishes permission errors, unrecognized speech and unsupported recognition', () => {
    expect(speechIssueFromError('not-allowed')).toBe('permission');
    expect(speechIssueFromError('no-speech')).toBe('unrecognized');
    expect(speechIssueFromError('audio-capture')).toBe('permission');
    expect(speechIssueFromError('network')).toBe('unavailable');
  });
});
