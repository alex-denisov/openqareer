import type { CandidateMemory, CoachResult } from '../coach/coachApi';
import type { ResumeDraft } from './resumeTypes';

export function hasConfirmedExperienceEvidence(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): boolean {
  const confirmedIds = new Set(
    memory.filter((item) => item.status === 'confirmed').map((item) => item.id),
  );
  return draft.experience.some((entry) =>
    entry.bulletMemoryIds.some((memoryId) => confirmedIds.has(memoryId)),
  );
}

export function groundedExperienceProposalIndex(
  result: CoachResult,
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): number | undefined {
  const experiences = new Map(draft.experience.map((entry) => [entry.id, entry]));
  const confirmedIds = new Set(
    memory.filter((item) => item.status === 'confirmed').map((item) => item.id),
  );

  const index = result.actionProposals.findIndex((proposal) => {
    const target = proposal.resumeRevision;
    if (proposal.kind !== 'resume.revise' || target?.section !== 'experience') return false;
    if (!target.experienceId || !target.memoryId || !confirmedIds.has(target.memoryId))
      return false;
    if (!proposal.evidenceRefs.includes(`memory:${target.memoryId}`)) return false;
    return experiences.get(target.experienceId)?.bulletMemoryIds.includes(target.memoryId) ?? false;
  });
  return index >= 0 ? index : undefined;
}
