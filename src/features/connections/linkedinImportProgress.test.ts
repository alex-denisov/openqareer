import { describe, expect, it } from 'vitest';
import {
  linkedinImportProgressView,
  reduceLinkedInImportProgress,
  type LinkedInImportProgress,
} from './linkedinImportProgress';

const keys = ['experience', 'education', 'skills'] as const;

describe('LinkedIn import progress', () => {
  it('starts with every section waiting and nothing read', () => {
    const state = reduceLinkedInImportProgress(null, { type: 'start', keys });
    expect(linkedinImportProgressView(state)).toEqual({
      readCount: 0,
      total: 3,
      stages: [
        { key: 'experience', label: 'места работы', done: false },
        { key: 'education', label: 'образование', done: false },
        { key: 'skills', label: 'навыки', done: false },
      ],
    });
  });

  it('marks a section read once and ignores repeats and unknown sections', () => {
    let state: LinkedInImportProgress | null = reduceLinkedInImportProgress(null, {
      type: 'start',
      keys,
    });
    state = reduceLinkedInImportProgress(state, { type: 'read', key: 'experience' });
    state = reduceLinkedInImportProgress(state, { type: 'read', key: 'experience' });
    state = reduceLinkedInImportProgress(state, { type: 'read', key: 'courses' });
    expect(linkedinImportProgressView(state)?.readCount).toBe(1);
  });

  it('has no view before a walk starts or after it ends', () => {
    expect(linkedinImportProgressView(null)).toBeNull();
    const started = reduceLinkedInImportProgress(null, { type: 'start', keys });
    expect(reduceLinkedInImportProgress(started, { type: 'end' })).toBeNull();
  });

  it('does not invent progress when a read arrives with no walk running', () => {
    expect(reduceLinkedInImportProgress(null, { type: 'read', key: 'skills' })).toBeNull();
  });
});
