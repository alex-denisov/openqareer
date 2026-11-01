import {
  PROFILE_ITEM_CONTEXT_MAX,
  PROFILE_ITEM_CONTEXT_TEXT_MAX,
  type CoachTurnInput,
} from '../domain/coach';
import { PROFILE_ITEM_FIELDS, PROFILE_ITEM_SECTIONS } from '../../shared/profileItemRevision';
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
    profileItems: profileItemsOf(draft),
  };
}

type ProfileItems = NonNullable<NonNullable<CoachTurnInput['resumeContext']>['profileItems']>;

/**
 * Only the fields a consultant may rewrite reach the model: links, credential
 * ids and evidence references stay out, long texts are cut.
 */
function profileItemsOf(draft?: ResumeDraft): ProfileItems {
  const record = (draft ?? {}) as unknown as Record<string, unknown>;
  return PROFILE_ITEM_SECTIONS.flatMap((section) => {
    const items = (record[section] ?? []) as readonly ({ id: string } & Record<string, unknown>)[];
    const fields = PROFILE_ITEM_FIELDS[section] as readonly string[];
    return items.map((item) => ({
      section,
      id: item.id,
      fields: Object.fromEntries(
        fields.flatMap((field) => {
          const value = item[field];
          if (typeof value !== 'string' && typeof value !== 'number') return [];
          const text = String(value).trim().slice(0, PROFILE_ITEM_CONTEXT_TEXT_MAX);
          return text ? [[field, text]] : [];
        }),
      ),
    }));
  }).slice(0, PROFILE_ITEM_CONTEXT_MAX);
}

export function withStoredTeamSizes<T extends { readonly draft: ResumeDraft }>(
  stored: T | null,
  memory: Parameters<typeof withWorkplaceTeamSizes>[1],
): T | null {
  if (!stored) return stored;
  const draft = withWorkplaceTeamSizes(stored.draft, memory);
  return draft === stored.draft ? stored : { ...stored, draft };
}
