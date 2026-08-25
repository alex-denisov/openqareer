import { describe, expect, it } from 'vitest';
import {
  candidateWorkspaceSchema,
  readStoredCandidateWorkspace,
} from './candidateWorkspace';

const answers = {
  resumeText: 'Синтетический кандидат: руководила продуктом в финтехе.',
  resumeSource: 'text' as const,
  targetDirection: 'Senior Product Manager',
  currentSituation: 'Ищу работу и рассматриваю релокацию.',
  constraints: 'Только удалённо или с релокацией.',
  urgency: 'active' as const,
};

/**
 * A stored row was written by an earlier release. Version 7 replaced the binary
 * `market` answer with a region list (B158); reading has to understand both,
 * or every candidate who answered the wizard before this release would get a
 * 500 instead of their own career context.
 */
describe('stored candidate workspace', () => {
  it('reads a row written with the pre-B158 market flag as regions', () => {
    expect(
      readStoredCandidateWorkspace({ ...answers, market: 'ru' }).regions,
    ).toEqual(['ru']);
  });

  it('does not invent a region for a row that only said «international»', () => {
    expect(
      readStoredCandidateWorkspace({ ...answers, market: 'international' })
        .regions,
    ).toEqual([]);
  });

  it('reads a current row unchanged', () => {
    expect(
      readStoredCandidateWorkspace({ ...answers, regions: ['eu', 'us'] })
        .regions,
    ).toEqual(['eu', 'us']);
  });

  it('stops accepting the market flag on write', () => {
    expect(
      candidateWorkspaceSchema.safeParse({ ...answers, market: 'ru' }).success,
    ).toBe(false);
    expect(
      candidateWorkspaceSchema.safeParse({ ...answers, regions: ['ru'] })
        .success,
    ).toBe(true);
  });

  it('prefers a row that already carries regions over its leftover market flag', () => {
    expect(
      readStoredCandidateWorkspace({
        ...answers,
        market: 'ru',
        regions: ['us'],
      }).regions,
    ).toEqual(['us']);
  });

  it('refuses a row that is not an object at all rather than guessing one', () => {
    expect(() => readStoredCandidateWorkspace('not a workspace')).toThrow();
    expect(() => readStoredCandidateWorkspace(null)).toThrow();
  });

  it('refuses a region that is not in the catalogue', () => {
    expect(
      candidateWorkspaceSchema.safeParse({ ...answers, regions: ['atlantis'] })
        .success,
    ).toBe(false);
  });
});
