import { describe, expect, it } from 'vitest';
import type { CareerCommand } from '../coach/coachApi';
import { careerDiaryAchievementProfileStatus } from './careerDiaryAchievementProfile';

function command(
  achievementId: string,
  status: CareerCommand['status'],
  profileRevisionReverted = false,
): CareerCommand {
  return {
    commandId: 'command-1',
    capability: 'resume.revise',
    status,
    profileRevisionReverted,
    proposal: {
      kind: 'resume.revise',
      objective: 'Добавить в профиль достижение из дневника.',
      evidenceRefs: [],
      acceptanceCriteria: ['Факт указан точно.'],
      expectedSignal: 'Достижение отражено в профиле.',
      measureAfter: '2026-12-31',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'about',
        experienceId: null,
        memoryId: null,
        proposedText: 'Достижение.',
      },
    },
    provenance: {
      strategyDecisionId: 'turn-1',
      evidenceRefs: ['diary:' + achievementId + ':message-1'],
      modelInvocationIds: ['response-1'],
    },
    execution: null,
  } as CareerCommand;
}

describe('careerDiaryAchievementProfileStatus', () => {
  it('reports an accepted diary-linked profile revision as added', () => {
    expect(careerDiaryAchievementProfileStatus('achievement-1', [
      command('achievement-1', 'completed_with_receipt'),
    ])).toBe('added');
  });

  it('does not treat unrelated profile suggestions as diary additions', () => {
    expect(careerDiaryAchievementProfileStatus('achievement-1', [
      command('achievement-other', 'completed_with_receipt'),
    ])).toBe('none');
  });

  it('makes a reverted achievement available for a new profile proposal', () => {
    expect(careerDiaryAchievementProfileStatus('achievement-1', [
      command('achievement-1', 'completed_with_receipt', true),
    ])).toBe('reverted');
  });
});
