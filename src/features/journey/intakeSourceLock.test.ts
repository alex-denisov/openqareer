import { describe, expect, it } from 'vitest';
import {
  MIN_TYPED_RESUME_LENGTH,
  intakeSourceLock,
  type IntakeSourceCommitment,
} from './intakeSourceLock';

const nothing: IntakeSourceCommitment = { typedLength: 0 };

describe('intakeSourceLock', () => {
  it('leaves every source open until something has actually been captured', () => {
    expect(intakeSourceLock(nothing).lockedTo).toBeUndefined();
    expect(intakeSourceLock({ ...nothing, typedLength: 12 }).lockedTo).toBeUndefined();
  });

  /**
   * The wizard used to accept a PDF *and* a connected profile *and* typed
   * text, leaving nothing to say which of the three the career picture was
   * built from. The owner named the consequence: once a candidate loads too
   * much, the priority between the sources is undefined.
   */
  it('fixes the source to the profile a platform import came from', () => {
    const lock = intakeSourceLock({ ...nothing, connectedPlatform: 'hh' });

    expect(lock.lockedTo).toBe('profile-import');
    expect(lock.reason).toContain('hh.ru');
  });

  it('fixes the source to the profile for either platform', () => {
    expect(intakeSourceLock({ ...nothing, connectedPlatform: 'linkedin' }).reason).toContain(
      'LinkedIn',
    );
    expect(
      intakeSourceLock({ ...nothing, ingestedSource: 'linkedin-pdf', ingestedImported: true })
        .lockedTo,
    ).toBe('profile-import');
    expect(
      intakeSourceLock({ ...nothing, ingestedSource: 'hh-pdf', ingestedImported: true })
        .lockedTo,
    ).toBe('profile-import');
  });

  it('fixes the source to the file once a PDF has been read', () => {
    const lock = intakeSourceLock({ ...nothing, ingestedSource: 'pdf' });

    expect(lock.lockedTo).toBe('pdf');
    expect(lock.reason).toContain('PDF');
  });

  /**
   * A PDF counts as captured the moment it is parsed, before the server
   * confirms storage: the text is already in hand, and offering a second
   * source at that point is what creates the ambiguity.
   */
  it('fixes the source to the file even before the server confirms storage', () => {
    expect(
      intakeSourceLock({ ...nothing, ingestedSource: 'pdf', ingestedImported: false })
        .lockedTo,
    ).toBe('pdf');
  });

  it('fixes the source to typed text once there is enough of it to use', () => {
    const lock = intakeSourceLock({ ...nothing, typedLength: MIN_TYPED_RESUME_LENGTH });

    expect(lock.lockedTo).toBe('text');
  });

  /**
   * Typed text is the one commitment a candidate can take back by deleting it,
   * so the lock has to follow the text down as well as up. A lock that only
   * ever tightened would trap someone who started typing by mistake.
   */
  it('releases the lock when the typed text is taken back', () => {
    expect(
      intakeSourceLock({ ...nothing, typedLength: MIN_TYPED_RESUME_LENGTH - 1 }).lockedTo,
    ).toBeUndefined();
  });

  /** An imported document outranks whatever is left in the textarea. */
  it('prefers an imported document over leftover typed text', () => {
    const lock = intakeSourceLock({
      typedLength: 400,
      ingestedSource: 'pdf',
    });

    expect(lock.lockedTo).toBe('pdf');
  });

  it('prefers a connected platform over an imported file', () => {
    const lock = intakeSourceLock({
      typedLength: 400,
      ingestedSource: 'pdf',
      connectedPlatform: 'linkedin',
    });

    expect(lock.lockedTo).toBe('profile-import');
  });

  it('always explains itself when it locks', () => {
    for (const commitment of [
      { ...nothing, connectedPlatform: 'hh' } as IntakeSourceCommitment,
      { ...nothing, ingestedSource: 'pdf' } as IntakeSourceCommitment,
      { ...nothing, typedLength: 400 },
    ]) {
      const lock = intakeSourceLock(commitment);
      expect(lock.lockedTo).toBeDefined();
      expect(lock.reason && lock.reason.length > 20).toBe(true);
    }
  });
});
