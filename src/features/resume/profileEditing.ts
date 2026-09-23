import type { ResumeDraft } from './resumeTypes';

export interface ProfileTopcardPatch {
  readonly fullName?: string;
  readonly headline?: string;
  readonly location?: string;
  readonly email?: string;
  readonly phone?: string;
}

/**
 * Patches only the topcard fields the "Изменить" disclosure edits, keeping
 * every other candidate field (photo, telegram, links, linkedinUrl) untouched.
 * `updateCandidate` in `resumeStudioModel` rebuilds the whole `candidate`
 * object from a narrower patch shape and would silently drop `headline`
 * and `linkedinUrl` — this stays a plain, additive spread instead.
 */
export function patchTopcard(draft: ResumeDraft, patch: ProfileTopcardPatch): ResumeDraft {
  return {
    ...draft,
    candidate: {
      ...draft.candidate,
      fullName: patch.fullName ?? draft.candidate.fullName,
      headline: patch.headline ?? draft.candidate.headline,
      contact: {
        ...draft.candidate.contact,
        location: patch.location ?? draft.candidate.contact?.location,
        email: patch.email ?? draft.candidate.contact?.email,
        phone: patch.phone ?? draft.candidate.contact?.phone,
      },
    },
  };
}

/**
 * "Open to work" is a proposal read from LinkedIn, never a silent write
 * (B265 §3c). A candidate who declines it should not see the same banner
 * again until a fresh import produces a new proposal — so the dismissal is
 * keyed by the exact suggestion it was shown for, not a one-time global flag.
 */
export function openToWorkDismissalKey(
  candidateId: string,
  suggestion: ResumeDraft['sourceSuggestions'],
): string | undefined {
  const openToWork = suggestion?.openToWork;
  if (!openToWork) return undefined;
  const fingerprint = [
    ...openToWork.roles,
    ...openToWork.locations,
    ...openToWork.workplaceTypes,
  ].join('|');
  return `career-profile-otw-dismissed:${candidateId}:${fingerprint}`;
}
