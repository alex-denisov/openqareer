import { describe, expect, it } from 'vitest';
import type { CandidateMemory, CoachResult } from '../coach/coachApi';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import {
  groundedExperienceProposalIndex,
  hasConfirmedExperienceEvidence,
} from './vacancyRequirementSuggestion';

const MEMORY_ID = 'fact-kubernetes-1';
const EXPERIENCE_ID = 'exp-platform-1';

function memory(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: MEMORY_ID,
    kind: 'fact',
    domain: 'responsibility',
    statement: 'Поддерживала внутреннюю платформу разработки.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['message-1'],
    sensitive: false,
    status: 'confirmed',
    ...overrides,
  };
}

function result(overrides: Partial<CoachResult['actionProposals'][number]> = {}): CoachResult {
  return {
    message: 'Есть подтверждённый факт опыта.',
    phase: 'resume',
    nextQuestion: null,
    completeness: { known: [], unknown: [] },
    safety: { needsHuman: false, reason: null },
    careerTrack: null,
    actionProposals: [
      {
        kind: 'resume.revise',
        objective: 'Уточнить подтверждённый факт опыта.',
        evidenceRefs: [`memory:${MEMORY_ID}`],
        acceptanceCriteria: ['Формулировка совпадает с источником.'],
        expectedSignal: 'Факт отражён в профиле.',
        measureAfter: '2026-10-01',
        risk: 'candidate_data_write',
        resumeRevision: {
          section: 'experience',
          experienceId: EXPERIENCE_ID,
          memoryId: MEMORY_ID,
          proposedText: 'Поддерживала внутреннюю платформу разработки на Kubernetes.',
        },
        ...overrides,
      },
    ],
  };
}

const draft = {
  ...EMPTY_RESUME_DRAFT,
  experience: [
    {
      id: EXPERIENCE_ID,
      chronologyMemoryId: 'chronology-1',
      title: 'Platform Engineer',
      employer: 'Acme',
      current: true,
      bulletMemoryIds: [MEMORY_ID],
    },
  ],
};

describe('vacancy requirement profile evidence (C66)', () => {
  it('accepts only a proposal tied to a confirmed fact on an existing experience', () => {
    expect(hasConfirmedExperienceEvidence(draft, [memory()])).toBe(true);
    expect(groundedExperienceProposalIndex(result(), draft, [memory()])).toBe(0);
  });

  it('routes to manual entry when the proposal has no existing supported experience', () => {
    const unsupported = result({
      evidenceRefs: ['memory:invented-fact'],
      resumeRevision: {
        section: 'experience',
        experienceId: EXPERIENCE_ID,
        memoryId: 'invented-fact',
        proposedText: 'Имею опыт Kubernetes.',
      },
    });

    expect(groundedExperienceProposalIndex(unsupported, draft, [memory()])).toBeUndefined();
    expect(hasConfirmedExperienceEvidence(draft, [memory({ status: 'proposed' })])).toBe(false);
    expect(
      groundedExperienceProposalIndex(result(), draft, [memory({ status: 'proposed' })]),
    ).toBeUndefined();
  });
});
