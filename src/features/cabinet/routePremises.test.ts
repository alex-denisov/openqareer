import { describe, expect, it } from 'vitest';
import {
  applyRoutePremises,
  routePremisesAccountPatch,
  routePremisesDraft,
  type RoutePremisesDraft,
} from './routePremises';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import type { AccountSnapshot } from '../coach/coachApi';

const workspace: CandidateWorkspace = {
  version: 7,
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z',
  resumeText: 'Senior Software Engineer, 8 лет опыта.',
  resumeSource: 'text',
  targetDirection: 'Senior Software Engineer',
  regions: ['ru'],
  currentSituation: 'Ищу работу ведущим инженером.',
  constraints: '',
  urgency: 'active',
  outcomes: [],
};

const account = {
  profile: {
    headline: 'Senior Software Engineer',
    workMode: 'hybrid' as const,
  },
} as AccountSnapshot;

const draft: RoutePremisesDraft = {
  targetRole: 'Руководитель продукта',
  regions: ['eu', 'ru'],
  workMode: 'remote',
};

describe('route premises editor state (B160)', () => {
  it('reads the current premises from the workspace and the account', () => {
    expect(routePremisesDraft({ workspace, account })).toEqual({
      targetRole: 'Senior Software Engineer',
      regions: ['ru'],
      workMode: 'hybrid',
    });
  });

  it('writes the new role and regions into a new workspace without mutating the old one', () => {
    const next = applyRoutePremises(workspace, draft);

    expect(next.targetDirection).toBe('Руководитель продукта');
    expect(next.regions).toEqual(['ru', 'eu']);
    expect(workspace.targetDirection).toBe('Senior Software Engineer');
    expect(workspace.regions).toEqual(['ru']);
  });

  it('keeps an empty region answer empty instead of guessing one', () => {
    const next = applyRoutePremises(workspace, { ...draft, regions: [] });

    expect(next.regions).toEqual([]);
  });

  it('patches the account only with what actually changed', () => {
    expect(routePremisesAccountPatch(draft, account)).toEqual({
      headline: 'Руководитель продукта',
      workMode: 'remote',
    });
  });

  it('sends no account request when nothing changed', () => {
    expect(
      routePremisesAccountPatch(
        { targetRole: 'Senior Software Engineer', regions: ['ru'], workMode: 'hybrid' },
        account,
      ),
    ).toBeNull();
  });

  it('refuses an empty role instead of storing a blank premise', () => {
    expect(applyRoutePremises(workspace, { ...draft, targetRole: '   ' }).targetDirection).toBe(
      'Senior Software Engineer',
    );
  });

  it('falls back to the workspace role and an empty answer when no account is loaded yet', () => {
    expect(routePremisesDraft({ workspace })).toEqual({
      targetRole: 'Senior Software Engineer',
      regions: ['ru'],
      workMode: null,
    });
  });

  it('offers empty premises to a candidate with neither store loaded', () => {
    expect(routePremisesDraft({})).toEqual({ targetRole: '', regions: [], workMode: null });
  });

  it('patches the work mode alone when only it changed', () => {
    expect(
      routePremisesAccountPatch(
        { targetRole: 'Senior Software Engineer', regions: ['ru'], workMode: null },
        account,
      ),
    ).toEqual({ workMode: null });
  });

  it('never patches the headline with a blank role', () => {
    expect(
      routePremisesAccountPatch(
        { targetRole: '  ', regions: ['ru'], workMode: 'hybrid' },
        account,
      ),
    ).toBeNull();
  });
});
