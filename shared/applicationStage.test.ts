import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STAGES,
  canLegacyClientAdvanceToApplied,
  isClosedApplicationStage,
  isKnownApplicationStage,
  deliveryState,
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
    for (const stage of [
      'applied',
      'responded',
      'interview',
      'offer',
      'rejected',
      'archived',
    ] as const) {
      expect(canLegacyClientAdvanceToApplied(stage)).toBe(false);
    }
  });

  it('treats archived and rejected as closed, everything else as live (B293)', () => {
    expect(APPLICATION_STAGES.filter(isClosedApplicationStage)).toEqual(['rejected', 'archived']);
  });

  it('counts an application as delivered only when it has a receipt', () => {
    expect(deliveryState('saved', null)).toBe('prepared');
    expect(deliveryState('applied', null)).toBe('attempted');
    expect(
      deliveryState('applied', { kind: 'confirmation_url', value: 'https://jobs.test/ok' }),
    ).toBe('delivered');
    expect(
      deliveryState('applied', { kind: 'failure_note', value: 'Форма отклонила отклик' }),
    ).toBe('failed');
  });
});
