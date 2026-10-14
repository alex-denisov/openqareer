import { useEffect, useMemo, useState } from 'react';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import { getVacancySources } from '../coach/coachApi';

export function VacancySourceHealthNotice({
  facets,
}: {
  readonly facets?: MatchedVacancyFacets;
}) {
  const sourceIdSet = useMemo(
    () => new Set(facets?.sources.map(({ sourceId }) => sourceId) ?? []),
    [facets],
  );
  const [sourceNames, setSourceNames] = useState<string[]>([]);

  useEffect(() => {
    if (sourceIdSet.size === 0) {
      setSourceNames([]);
      return undefined;
    }
    let active = true;
    void getVacancySources()
      .then((sources) => {
        const affected = sources
          .filter(
            (source) =>
              sourceIdSet.has(source.id) &&
              (source.health.status === 'degraded' || source.health.status === 'unavailable'),
          )
          .map((source) => source.name.trim())
          .filter(Boolean);
        if (active) setSourceNames(affected);
      })
      .catch(() => {
        if (active) setSourceNames([]);
      });
    return () => {
      active = false;
    };
  }, [sourceIdSet]);

  if (sourceNames.length === 0) return null;
  return (
    <p className="career-inline-note vacancies-source-health-note" role="status">
      Некоторые источники недоступны или отвечают с ошибками: {sourceNames.join(', ')}. Объём
      затронутых вакансий не определён.
    </p>
  );
}
