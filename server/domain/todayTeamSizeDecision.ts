import { teamSizeRequirement } from '../../shared/teamSizeRequirement';
import type { ResumeDraft } from './resumeDraft';

/**
 * B540: «Подтвердите размер команды в «<компания>»» is born only from data —
 * the current place has no team size and favorites name a team they want led.
 * Without such favorites there is no reason to ask, so nothing is returned.
 */
export interface TodayTeamSizeDecision {
  readonly kind: 'team_size';
  readonly experienceId: string;
  readonly employer: string;
  readonly title?: string;
  readonly favoritesTotal: number;
  readonly favoritesAsking: number;
  readonly minTeamSize: number;
  readonly readAt: string;
}

export interface TodayTeamSizeDecisionInput {
  readonly experience: ResumeDraft['experience'];
  /** Every favorite (stage «saved»), with whatever vacancy text is known for it. */
  readonly favorites: readonly { readonly text: string }[];
  readonly now: string;
}

function currentPlaceWithoutTeamSize(experience: ResumeDraft['experience']) {
  return [...experience]
    .filter((entry) => entry.current && !entry.teamSize && entry.employer?.trim())
    .sort((left, right) => (right.startDate ?? '').localeCompare(left.startDate ?? ''))[0];
}

export function buildTodayTeamSizeDecision(
  input: TodayTeamSizeDecisionInput,
): TodayTeamSizeDecision | null {
  const place = currentPlaceWithoutTeamSize(input.experience);
  if (!place?.employer) return null;
  const required = input.favorites.flatMap((favorite) => {
    const size = teamSizeRequirement(favorite.text);
    return size === null ? [] : [size];
  });
  if (!required.length) return null;
  return {
    kind: 'team_size',
    experienceId: place.id,
    employer: place.employer.trim(),
    ...(place.title?.trim() ? { title: place.title.trim() } : {}),
    favoritesTotal: input.favorites.length,
    favoritesAsking: required.length,
    minTeamSize: Math.min(...required),
    readAt: input.now,
  };
}
