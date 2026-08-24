import { describe, expect, it } from 'vitest';
import { applyCanonicalProfileToJourney, buildCareerJourney } from './careerJourneyEngine';
import { createWorkspace } from '../workspace/workspaceStorage';

/**
 * Production said "13 подтверждённых фактов" on the profile tile and, on the
 * same screen, "Подтвердите опорные факты — кандидат ещё не подтвердил их
 * точность" as the next step: the wizard's own analysis still called its
 * evidence pending, and the canonical layer fell back to it once memory had
 * nothing left to review (B166).
 */
function baseJourneyStuckOnReview() {
  const workspace = createWorkspace(
    {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: 'Head of Platform',
      market: 'international',
      currentSituation: 'Ищу роль руководителя платформы.',
      constraints: '',
      urgency: 'active',
    },
    '2026-08-25T00:00:00.000Z',
  );
  const journey = buildCareerJourney(workspace, '2026-08-25T00:01:00.000Z');
  return {
    ...journey,
    nextAction: {
      id: 'review-evidence',
      label: 'Проверить факты',
      headline: 'Подтвердите опорные факты',
      reason: 'Из источника извлечены утверждения, но кандидат ещё не подтвердил их точность.',
      expectedChange: 'Подтверждённые факты станут основанием для сравнения ролей.',
      destination: 'career' as const,
    },
  };
}

const confirmedMemory = [
  {
    id: 'fact-outcome',
    kind: 'fact' as const,
    domain: 'outcome' as const,
    status: 'confirmed' as const,
    sourceMessageIds: ['import-1'],
    statement: 'Снизила частоту платёжных инцидентов на 62%.',
  },
  {
    id: 'fact-responsibility',
    kind: 'fact' as const,
    domain: 'responsibility' as const,
    status: 'confirmed' as const,
    sourceMessageIds: ['import-1'],
    statement: 'Отвечала за платформенную команду из 34 инженеров.',
  },
  {
    id: 'fact-role',
    kind: 'fact' as const,
    domain: 'role-evidence' as const,
    status: 'confirmed' as const,
    sourceMessageIds: ['import-1'],
    statement: 'Head of Platform — Fintech Bureau (2021-01 — 2025-10)',
  },
];

describe('stale review-evidence next action', () => {
  it('stops asking for a review the candidate has already finished', () => {
    const journey = applyCanonicalProfileToJourney(
      baseJourneyStuckOnReview(),
      confirmedMemory,
      'Head of Platform',
      '2026-08-25T00:02:00.000Z',
    );

    expect(journey.profile).toMatchObject({ proposedEvidence: 0 });
    expect(journey.nextAction.id).not.toBe('review-evidence');
    expect(journey.nextAction.headline).not.toContain('Подтвердите опорные факты');
  });

  it('still asks for the review while facts are actually waiting', () => {
    const journey = applyCanonicalProfileToJourney(
      baseJourneyStuckOnReview(),
      [
        ...confirmedMemory,
        { ...confirmedMemory[0]!, id: 'fact-pending', status: 'proposed' as const },
      ],
      'Head of Platform',
      '2026-08-25T00:02:00.000Z',
    );

    expect(journey.nextAction.id).toBe('review-evidence');
  });
});
