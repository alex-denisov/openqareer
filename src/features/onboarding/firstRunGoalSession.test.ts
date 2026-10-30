// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clearSessionGoal, readSessionGoal, saveSessionGoal } from './firstRunStorage';

describe('first-run goal in sessionStorage (block A 30.10)', () => {
  afterEach(() => sessionStorage.clear());

  it('keeps the saved goal across a reload until the wizard ends', () => {
    expect(readSessionGoal()).toBe('');
    saveSessionGoal('  Хочу понять, на какие руководящие роли могу идти.  ');
    expect(readSessionGoal()).toBe('Хочу понять, на какие руководящие роли могу идти.');
    clearSessionGoal();
    expect(readSessionGoal()).toBe('');
  });

  it('does not store an empty goal', () => {
    saveSessionGoal('   ');
    expect(readSessionGoal()).toBe('');
  });
});
