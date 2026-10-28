import type { CoachTurnInput } from '../domain/coach';
import type { ResumeDraft } from '../domain/resumeDraft';
import { withWorkplaceTeamSizes } from '../domain/workplaceTeamSize';

export function resumeContextOf(
  draft?: ResumeDraft,
): NonNullable<CoachTurnInput['resumeContext']> {
  return {
    headline: draft?.candidate.headline ?? null,
    about: draft?.candidate.about ?? null,
    // Period and team size belong to each workplace: the model compares a place
    // with itself, not 6 people at one employer with 8 at another (27.10).
    experiences: (draft?.experience ?? []).map((experience) => ({
      id: experience.id,
      title: experience.title ?? null,
      employer: experience.employer ?? null,
      startDate: experience.startDate ?? null,
      endDate: experience.endDate ?? null,
      current: experience.current,
      teamSize: experience.teamSize ?? null,
      descriptionMemoryId: experience.descriptionMemoryId ?? null,
      bulletMemoryIds: [...experience.bulletMemoryIds],
    })),
  };
}

export function withStoredTeamSizes<T extends { readonly draft: ResumeDraft }>(
  stored: T | null,
  memory: Parameters<typeof withWorkplaceTeamSizes>[1],
): T | null {
  if (!stored) return stored;
  const draft = withWorkplaceTeamSizes(stored.draft, memory);
  return draft === stored.draft ? stored : { ...stored, draft };
}
