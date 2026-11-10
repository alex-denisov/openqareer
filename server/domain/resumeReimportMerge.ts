import type {
  ResumeDraft,
  ResumeExperienceInput,
  ResumeProfileUpdateInput,
  ResumeSkillInput,
} from './resumeDraft';
import { skillKey } from '../orchestration/skillRevision';

/**
 * A re-import from the same platform merges into the profile instead of
 * replacing it (owner rule: a re-import never silently destroys candidate or
 * consultant edits). 01.11 a LinkedIn walk minted new entry ids, dropped a
 * quiz-confirmed skill LinkedIn does not list and orphaned four accepted
 * consultant revisions.
 */
export interface ProtectedProfileEdits {
  readonly headline: boolean;
  readonly about: boolean;
  readonly experienceIds: ReadonlySet<string>;
  readonly skillKeys: ReadonlySet<string>;
}

export interface RevisionProvenance {
  readonly section: string;
  readonly experienceId?: string | null;
  readonly revertedAt?: string | null;
}

export type ImportPlatform = ResumeProfileUpdateInput['platform'];

/** B639: the candidate's answer about a masked employer survives a re-import of the same place. */
function employerNameAnswer(entry: ResumeExperienceInput): Partial<ResumeExperienceInput> {
  const { employerRealName, employerNameMemoryId, employerMaskKept } = entry;
  return {
    ...(employerRealName ? { employerRealName } : {}),
    ...(employerNameMemoryId ? { employerNameMemoryId } : {}),
    ...(employerMaskKept ? { employerMaskKept } : {}),
  };
}

export function protectedEditsFromRevisions(
  revisions: readonly RevisionProvenance[],
): ProtectedProfileEdits {
  const live = revisions.filter((revision) => !revision.revertedAt);
  const ids = (section: string) =>
    new Set(
      live
        .filter((revision) => revision.section === section && revision.experienceId)
        .map((revision) => revision.experienceId as string),
    );
  return {
    headline: live.some((revision) => revision.section === 'headline'),
    about: live.some((revision) => revision.section === 'about'),
    experienceIds: ids('experience'),
    skillKeys: ids('skills'),
  };
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');
}

/** Employer + start date first; a consultant may have fixed the date, so employer + title second. */
function roleKeys(role: ResumeExperienceInput): string[] {
  return [
    `${norm(role.employer)}|${norm(role.startDate)}`,
    `${norm(role.employer)}|t:${norm(role.title)}`,
  ];
}

interface MergeResult<T> {
  readonly entries: readonly T[];
  readonly proposals: readonly ResumeProfileUpdateInput[];
}

function mergeExperience(
  incoming: readonly ResumeExperienceInput[],
  existing: readonly ResumeExperienceInput[],
  edits: ProtectedProfileEdits,
  platform: ImportPlatform,
): MergeResult<ResumeExperienceInput> {
  const used = new Set<string>();
  const findMatch = (role: ResumeExperienceInput) => {
    for (const key of roleKeys(role)) {
      const match = existing.find(
        (candidate) => !used.has(candidate.id) && roleKeys(candidate).includes(key),
      );
      if (match) return match;
    }
    return undefined;
  };
  const proposals: ResumeProfileUpdateInput[] = [];
  const merged = incoming.map((role) => {
    const match = findMatch(role);
    if (!match) return role;
    used.add(match.id);
    if (!edits.experienceIds.has(match.id)) return { ...role, ...employerNameAnswer(match), id: match.id };
    if (role.title && norm(role.title) !== norm(match.title)) {
      proposals.push({ platform, section: 'experience', entryId: match.id, field: 'title', proposedText: role.title });
    }
    const logo = match.employerLogoMediaId ?? role.employerLogoMediaId;
    return { ...match, ...(logo ? { employerLogoMediaId: logo } : {}) };
  });
  const keptEdited = existing.filter(
    (role) => !used.has(role.id) && edits.experienceIds.has(role.id),
  );
  return { entries: [...merged, ...keptEdited], proposals };
}

/** A confirmation, level or quiz date is the candidate's state, never the source's. */
function carriesCandidateState(skill: ResumeSkillInput): boolean {
  return Boolean(skill.level || skill.status || skill.verifiedAt);
}

function mergeSkills(
  incoming: readonly ResumeSkillInput[],
  existing: readonly ResumeSkillInput[],
  edits: ProtectedProfileEdits,
): readonly ResumeSkillInput[] {
  const byKey = new Map(existing.map((skill) => [skillKey(skill.name), skill]));
  const seen = new Set<string>();
  const merged = incoming.map((skill) => {
    const key = skillKey(skill.name);
    seen.add(key);
    const match = byKey.get(key);
    if (!match) return skill;
    return {
      ...skill,
      id: match.id,
      ...(match.level ? { level: match.level } : {}),
      ...(match.status ? { status: match.status } : {}),
      ...(match.source && carriesCandidateState(match) ? { source: match.source } : {}),
      ...(match.verifiedAt ? { verifiedAt: match.verifiedAt } : {}),
    };
  });
  const kept = existing.filter((skill) => {
    const key = skillKey(skill.name);
    return !seen.has(key) && (carriesCandidateState(skill) || edits.skillKeys.has(key));
  });
  return [...merged, ...kept];
}

function mergeCandidateText(
  incoming: ResumeDraft['candidate'],
  existing: ResumeDraft['candidate'],
  edits: ProtectedProfileEdits,
  platform: ImportPlatform,
): MergeResult<ResumeDraft['candidate']> {
  const proposals: ResumeProfileUpdateInput[] = [];
  let candidate = incoming;
  for (const field of ['headline', 'about'] as const) {
    const kept = existing[field];
    if (!edits[field] || !kept) continue;
    const offered = incoming[field];
    if (offered && norm(offered) !== norm(kept)) {
      proposals.push({ platform, section: field, field, proposedText: offered });
    }
    candidate = { ...candidate, [field]: kept };
  }
  return { entries: [candidate], proposals };
}

function proposalKey(proposal: ResumeProfileUpdateInput): string {
  return `${proposal.platform}|${proposal.section}|${proposal.entryId ?? ''}|${proposal.field}`;
}

function survivingProposals(
  previous: readonly ResumeProfileUpdateInput[],
  fresh: readonly ResumeProfileUpdateInput[],
  draft: ResumeDraft,
): readonly ResumeProfileUpdateInput[] {
  const freshKeys = new Set(fresh.map(proposalKey));
  const roleIds = new Set(draft.experience.map((role) => role.id));
  const stillTargeted = previous.filter(
    (proposal) =>
      !freshKeys.has(proposalKey(proposal)) &&
      (proposal.section !== 'experience' || roleIds.has(proposal.entryId ?? '')),
  );
  return [...stillTargeted, ...fresh];
}

export function mergeReimportedDraft(
  incoming: ResumeDraft,
  existing: ResumeDraft | undefined,
  edits: ProtectedProfileEdits,
  platform: ImportPlatform,
): ResumeDraft {
  if (!existing) return incoming;
  const experience = mergeExperience(incoming.experience, existing.experience, edits, platform);
  const candidate = mergeCandidateText(incoming.candidate, existing.candidate, edits, platform);
  const merged: ResumeDraft = {
    ...incoming,
    candidate: candidate.entries[0],
    experience: experience.entries,
    skills: mergeSkills(incoming.skills ?? [], existing.skills ?? [], edits),
    // Accepted and declined consultant rewrites are the candidate's decisions;
    // dropping them re-offered the same bullets with «Принять» (01.11).
    ...(existing.factRewrites ? { factRewrites: existing.factRewrites } : {}),
    ...(existing.declinedFactIds ? { declinedFactIds: existing.declinedFactIds } : {}),
    ...(existing.factRewriteProposal ? { factRewriteProposal: existing.factRewriteProposal } : {}),
  };
  const profileUpdates = survivingProposals(
    existing.sourceSuggestions?.profileUpdates ?? [],
    [...experience.proposals, ...candidate.proposals],
    merged,
  );
  if (profileUpdates.length === 0) return merged;
  return { ...merged, sourceSuggestions: { ...merged.sourceSuggestions, profileUpdates } };
}
