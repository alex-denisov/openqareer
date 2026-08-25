import { describe, expect, it } from 'vitest';
import { resolveCandidateWorkspace } from './workspaceHydration';
import { prepareCareerWorkspace } from '../journey/careerJourneyEngine';

const input = {
  resumeText:
    'Синтетический кандидат: руководила продуктом в финтехе и отвечала за активацию.',
  resumeSource: 'text' as const,
  targetDirection: 'Senior Product Manager',
  regions: ['eu'] as const,
  currentSituation: 'Ищу работу за рубежом.',
  constraints: '',
  urgency: 'active' as const,
};

/**
 * Signing out cleared browser storage and signing back in restarted the
 * diagnostic with every section locked, while the server held the candidate's
 * answers the whole time (INC-024).
 */
describe('resolveCandidateWorkspace', () => {
  it('rebuilds the workspace from the server when browser storage is empty', () => {
    const resolved = resolveCandidateWorkspace({
      local: { status: 'empty' },
      remote: input,
    });

    expect(resolved?.targetDirection).toBe('Senior Product Manager');
    expect(resolved?.regions).toEqual(['eu']);
  });

  it('keeps the local workspace, which may hold edits the server has not seen', () => {
    const local = prepareCareerWorkspace({ ...input, targetDirection: 'Head of Product' });

    const resolved = resolveCandidateWorkspace({
      local: { status: 'ready', workspace: local },
      remote: input,
    });

    expect(resolved?.targetDirection).toBe('Head of Product');
  });

  it('leaves a genuinely new candidate on the wizard', () => {
    expect(
      resolveCandidateWorkspace({ local: { status: 'empty' }, remote: null }),
    ).toBeUndefined();
  });

  it('does not resurrect a workspace from unreadable local storage without a server copy', () => {
    expect(
      resolveCandidateWorkspace({ local: { status: 'invalid' }, remote: null }),
    ).toBeUndefined();
  });

  it('recovers from unreadable local storage when the server has the answers', () => {
    const resolved = resolveCandidateWorkspace({
      local: { status: 'invalid' },
      remote: input,
    });

    expect(resolved?.targetDirection).toBe('Senior Product Manager');
  });
});
