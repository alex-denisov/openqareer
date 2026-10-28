import { teamSizeFromWorkplaceText } from '../../shared/workplaceTeamSize';
import type { ResumeDraft } from './resumeDraft';

interface MemoryText {
  readonly id: string;
  readonly statement: string;
}

function plainId(id: string): string {
  return id.replace(/^memory:/u, '');
}

/**
 * Each workplace carries its own team size: a size the candidate stated stays,
 * otherwise it is read from that workplace's description and bullets only.
 * «О себе» and other places never lend their numbers, so 6 people at one
 * employer and 8 at another stay two facts instead of one contradiction.
 */
export function withWorkplaceTeamSizes(
  draft: ResumeDraft,
  memory: readonly MemoryText[],
): ResumeDraft {
  const textById = new Map(memory.map((item) => [plainId(item.id), item.statement]));
  let changed = false;
  const experience = draft.experience.map((place) => {
    if (place.teamSize) return place;
    const text = [place.descriptionMemoryId, ...place.bulletMemoryIds]
      .flatMap((id) => (id ? [textById.get(plainId(id)) ?? ''] : []))
      .join('\n');
    const teamSize = teamSizeFromWorkplaceText(text);
    if (teamSize === null) return place;
    changed = true;
    return { ...place, teamSize };
  });
  return changed ? { ...draft, experience } : draft;
}
