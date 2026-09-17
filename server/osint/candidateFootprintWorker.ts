import type { CandidateStore } from '../data/candidateStore';
import type { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import {
  performCandidateReputationAudit,
  type CandidateExperienceItem,
  type ExternalSourceProfile,
  type PublicPostItem,
} from './candidateReputationService';
import type { CandidateReputationAudit } from '../../shared/candidateReputation';

export interface FootprintWorkerInput {
  candidateId: string;
  repo: SqliteCandidateReputationRepository;
  candidateStore?: CandidateStore;
  options?: {
    experience?: CandidateExperienceItem[];
    externalProfiles?: ExternalSourceProfile[];
    publicPosts?: PublicPostItem[];
  };
}

function extractExperience(
  candidateId: string,
  candidateStore?: CandidateStore,
): CandidateExperienceItem[] {
  if (!candidateStore) return [];
  try {
    const snapshot = candidateStore.getSnapshot(candidateId);
    const experiences = snapshot.resume?.draft?.experience ?? [];
    return experiences.map((exp) => ({
      id: exp.id,
      company: exp.employer ?? '',
      role: exp.title ?? '',
      startDate: exp.startDate ?? '',
      endDate: exp.endDate,
      current: exp.current,
    }));

  } catch {
    return [];
  }
}

export async function runCandidateFootprintAudit(
  input: FootprintWorkerInput,
): Promise<CandidateReputationAudit> {
  const { candidateId, repo, candidateStore, options } = input;
  const experience =
    options?.experience ?? extractExperience(candidateId, candidateStore);
  const externalProfiles = options?.externalProfiles ?? [];
  const publicPosts = options?.publicPosts ?? [];

  const audit = performCandidateReputationAudit({
    candidateId,
    experience,
    externalProfiles,
    publicPosts,
  });

  repo.saveAudit(audit);
  return audit;
}
