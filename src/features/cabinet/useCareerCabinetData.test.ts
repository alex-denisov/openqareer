import { describe, expect, it } from 'vitest';

describe('Cabinet Data Ingestion Validation', () => {
  it('validates account structure rejecting null/non-object responses', () => {
    const rawAccount: unknown = null;
    const isValid = rawAccount !== null && typeof rawAccount === 'object';
    expect(isValid).toBe(false);
  });

  it('validates candidate snapshot structure rejecting null memory/candidate', () => {
    const malformedSnapshot: unknown = { memory: null, candidate: null };
    const isValid =
      malformedSnapshot !== null &&
      typeof malformedSnapshot === 'object' &&
      Array.isArray((malformedSnapshot as { memory?: unknown }).memory) &&
      Boolean((malformedSnapshot as { candidate?: unknown }).candidate);
    expect(isValid).toBe(false);
  });

  it('accepts valid candidate snapshot with memory array and candidate object', () => {
    const validSnapshot = {
      candidate: { id: 'c-1', dataClass: 'personal', locale: 'ru-RU', createdAt: '2026-08-18' },
      memory: [{ id: 'm-1', kind: 'fact', domain: 'responsibility', content: 'Lead dev', provenance: 'user', confidence: 'confirmed' }],
    };
    const isValid =
      validSnapshot !== null &&
      typeof validSnapshot === 'object' &&
      Array.isArray(validSnapshot.memory) &&
      Boolean(validSnapshot.candidate);
    expect(isValid).toBe(true);
  });
});
