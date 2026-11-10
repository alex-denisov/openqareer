import { sourceKind } from '../../vacancies/poolLiveness';
import { linkEmployerSource, placementTypeOf, type LinkageIndex, type PlacementType } from './placementLinkage';

/** Приоритет размещения: сайт → ATS → LinkedIn → агрегатор (меньше — лучше). */
export const PLACEMENT_PRIORITY: Readonly<Record<PlacementType, number>> = {
  employer_site: 1,
  ats: 2,
  linkedin: 3,
  aggregator: 4,
};

export interface Placement {
  readonly placementId: string;
  readonly companyKey: string | null;
  readonly type: PlacementType;
  readonly provider: string | null;
  readonly slug: string | null;
  readonly priority: number;
  readonly sourceId: string;
}

function atsSlugOf(sourceId: string, provider: string): string | null {
  for (const prefix of [`ats-${provider}-`, `src-fh-${provider}-`]) {
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length).toLowerCase();
  }
  return null;
}

const ID_PREFIX: Readonly<Record<PlacementType, string>> = {
  employer_site: 'site',
  ats: 'ats',
  linkedin: 'li',
  aggregator: 'agg',
};

/** Размещение по `source_id`; тип берётся из `sourceKind()` (B642). */
export function placementOf(sourceId: string, index: LinkageIndex): Placement {
  const kind = sourceKind(sourceId);
  const type = placementTypeOf(kind);
  const provider = kind.kind === 'ats' ? kind.provider : null;
  const slug = provider ? atsSlugOf(sourceId, provider) : null;
  const placementId = provider && slug ? `ats:${provider}:${slug}` : `${ID_PREFIX[type]}:${sourceId}`;
  return {
    placementId,
    companyKey: linkEmployerSource(sourceId, index)?.companyKey ?? null,
    type,
    provider,
    slug,
    priority: PLACEMENT_PRIORITY[type],
    sourceId,
  };
}
