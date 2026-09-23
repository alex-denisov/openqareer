import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STAGES,
  canLegacyClientAdvanceToApplied,
  isKnownApplicationStage,
} from './applicationStage';

describe('applicationStage', () => {
  it('lists exactly the seven stages from architecture.md §3', () => {
    expect(APPLICATION_STAGES).toEqual([
      'saved',
      'applied',
      'responded',
      'interview',
      'offer',
      'rejected',
      'archived',
    ]);
  });

  it('recognises known stages and rejects unknown strings', () => {
    expect(isKnownApplicationStage('interview')).toBe(true);
    expect(isKnownApplicationStage('nonsense')).toBe(false);
  });

  it('lets the legacy client advance from empty or saved to applied', () => {
    expect(canLegacyClientAdvanceToApplied(null)).toBe(true);
    expect(canLegacyClientAdvanceToApplied('saved')).toBe(true);
  });

  it('never lets the legacy client advance a card that moved past saved', () => {
    for (const stage of ['applied', 'responded', 'interview', 'offer', 'rejected', 'archived'] as const) {
      expect(canLegacyClientAdvanceToApplied(stage)).toBe(false);
    }
  });
});
