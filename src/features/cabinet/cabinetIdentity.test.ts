import { describe, expect, it } from 'vitest';
import { cabinetDisplayName } from './cabinetIdentity';
import type { ResumeStudioView } from '../resume/resumeTypes';

function resumeWithName(fullName: string | null): ResumeStudioView {
  return {
    draft: null,
    savedAt: null,
    projection: {
      master: { contact: { fullName } },
    },
    evidenceFreshness: { stale: [] },
  } as unknown as ResumeStudioView;
}

describe('how the cabinet addresses the candidate', () => {
  it('uses the name the candidate entered on the account first', () => {
    expect(
      cabinetDisplayName({
        sessionDisplayName: 'Мария Иванова',
        username: 'candidate.test',
      }),
    ).toBe('Мария Иванова');
  });

  /**
   * The owner connected a real hh.ru profile and the cabinet still greeted
   * them with their login, so nothing on screen showed the import had
   * happened (owner report, 2026-08-26).
   */
  it('falls back to the name the imported document states, not to the login', () => {
    expect(
      cabinetDisplayName({
        resume: resumeWithName('Мария Иванова'),
        username: 'candidate.test',
      }),
    ).toBe('Мария Иванова');
  });

  it('keeps the login when nothing states a name', () => {
    expect(
      cabinetDisplayName({ resume: resumeWithName(null), username: 'candidate.test' }),
    ).toBe('candidate.test');
    expect(
      cabinetDisplayName({ sessionDisplayName: '   ', username: 'candidate.test' }),
    ).toBe('candidate.test');
  });
});
