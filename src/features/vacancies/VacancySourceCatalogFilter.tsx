import { useEffect, useMemo, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import {
  MATCHED_VACANCY_SOURCE_GROUPS,
  type MatchedVacancyFacets,
  type MatchedVacancySourceGroupId,
} from '../../../shared/matchedVacancyFacets';
import { getVacancySources, type VacancySourceRegistryEntry } from '../coach/coachApi';
import type { VacanciesScreenState } from './vacanciesScreenState';

interface VacancySourceCatalogFilterProps {
  readonly state: VacanciesScreenState;
  readonly facets: MatchedVacancyFacets;
  readonly onChange: (update: (previous: VacanciesScreenState) => VacanciesScreenState) => void;
}

interface SourceOption {
  readonly sourceId: string;
  readonly name: string;
  readonly count: number;
  readonly groupId: MatchedVacancySourceGroupId | null;
  readonly searchableText: string;
}

type SourceGroupSelection = MatchedVacancySourceGroupId | 'all';

const SOURCE_GROUP_BY_CATEGORY: Readonly<Record<string, MatchedVacancySourceGroupId>> = {
  'ATS компаний': 'ats',
  'Агрегаторы и API': 'aggregators',
  'Международные площадки': 'platforms',
  'Telegram каналы': 'channels',
};

export function VacancySourceCatalogFilter(props: VacancySourceCatalogFilterProps) {
  const catalog = useSourceCatalog();
  const view = useSourceFilterView(props, catalog.sources);
  return <SourceCatalogContent facets={props.facets} catalog={catalog} view={view} />;
}

function useSourceCatalog() {
  const [sources, setSources] = useState<VacancySourceRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getVacancySources()
      .then((items) => {
        if (active) setSources(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { sources, loading, failed };
}

function buildSourceOptions(
  facets: MatchedVacancyFacets,
  catalog: readonly VacancySourceRegistryEntry[],
): SourceOption[] {
  const counts = new Map(facets.sources.map(({ sourceId, count }) => [sourceId, count]));
  const catalogIds = new Set<string>(catalog.map(({ id }) => id));
  const fromCatalog = catalog.map((source) => {
    const count = counts.get(source.id) ?? 0;
    return {
      sourceId: source.id,
      name: source.name,
      count,
      groupId: source.category ? (SOURCE_GROUP_BY_CATEGORY[source.category] ?? null) : null,
      searchableText: sourceSearchText(source),
    };
  });
  const fromFacets = facets.sources
    .filter(({ sourceId }) => !catalogIds.has(sourceId))
    .map(({ sourceId, name, count }) => ({
      sourceId,
      name,
      count,
      groupId: null,
      searchableText: [sourceId, name].join(' ').toLocaleLowerCase(),
    }));
  return [...fromCatalog, ...fromFacets];
}

function sourceSearchText(source: VacancySourceRegistryEntry): string {
  return [
    source.id,
    source.name,
    source.market,
    source.category,
    source.searchCoverage,
    source.attributionUrl,
    source.documentationUrl,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function SourceCategoryFilters({
  facets,
  catalogCount,
  group,
  onSelect,
}: {
  readonly facets: MatchedVacancyFacets;
  readonly catalogCount: number;
  readonly group: SourceGroupSelection;
  readonly onSelect: (group: SourceGroupSelection) => void;
}) {
  const groupCounts = new Map(facets.sourceGroups?.map(({ id, count }) => [id, count]));
  return (
    <div className="vacancy-source-categories" role="group" aria-label="Категории источников">
      <button
        type="button"
        className="career-btn is-sm"
        aria-pressed={group === 'all'}
        onClick={() => onSelect('all')}
      >
        Все источники · {catalogCount}
      </button>
      {MATCHED_VACANCY_SOURCE_GROUPS.map((sourceGroup) => {
        const count = groupCounts.get(sourceGroup.id);
        return (
          <button
            key={sourceGroup.id}
            type="button"
            className="career-btn is-sm"
            aria-pressed={group === sourceGroup.id}
            onClick={() => onSelect(sourceGroup.id)}
          >
            {sourceGroup.name}
            {count === undefined ? '' : ' · ' + count}
          </button>
        );
      })}
    </div>
  );
}

function SourceOptionList({
  catalog,
  sources,
  total,
  visibleCount,
  selectedSources,
  onToggleSource,
  onShowMore,
}: {
  readonly catalog: ReturnType<typeof useSourceCatalog>;
  readonly sources: readonly SourceOption[];
  readonly total: number;
  readonly visibleCount: number;
  readonly selectedSources: readonly string[];
  readonly onToggleSource: (sourceId: string) => void;
  readonly onShowMore: () => void;
}) {
  return (
    <fieldset className="vacancy-source-group">
      <legend>Источники в каталоге</legend>
      {catalog.loading ? <p role="status">Загружаем каталог источников…</p> : null}
      {catalog.failed ? (
        <p role="status">Каталог не загрузился. Показаны источники из текущей подборки.</p>
      ) : null}
      {sources.length > 0 ? (
        <div className="chip-row vacancy-source-options">
          {sources.map((source) => (
            <SourceOptionButton
              key={source.sourceId}
              source={source}
              selected={selectedSources.includes(source.sourceId)}
              onClick={() => onToggleSource(source.sourceId)}
            />
          ))}
        </div>
      ) : (
        <p role="status">
          {total === 0 ? 'Источников по этому запросу нет.' : 'Список источников пока пуст.'}
        </p>
      )}
      {visibleCount < total ? (
        <button type="button" className="career-btn is-sm is-ghost" onClick={onShowMore}>
          Показать ещё 20
        </button>
      ) : null}
    </fieldset>
  );
}

function SourceSelectionActions({
  selectedCount,
  catalogCount,
  visibleCount,
  allVisibleSelected,
  onToggleAll,
  onClear,
}: {
  readonly selectedCount: number;
  readonly catalogCount: number;
  readonly visibleCount: number;
  readonly allVisibleSelected: boolean;
  readonly onToggleAll: () => void;
  readonly onClear: () => void;
}) {
  return (
    <div className="vacancy-source-selection" role="group" aria-label="Выбор источников">
      <span aria-live="polite">
        Выбрано {selectedCount} из {catalogCount}
      </span>
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        disabled={visibleCount === 0}
        aria-pressed={allVisibleSelected}
        onClick={onToggleAll}
      >
        Все {visibleCount}
      </button>
      <button type="button" className="career-btn is-sm is-ghost" onClick={onClear}>
        Снять все
      </button>
    </div>
  );
}

function updateSelectedSource(
  onChange: VacancySourceCatalogFilterProps['onChange'],
  sourceId: string,
): void {
  onChange((previous) => ({
    ...previous,
    sources: previous.sources?.includes(sourceId)
      ? previous.sources.filter((id) => id !== sourceId)
      : [...(previous.sources ?? []), sourceId],
  }));
}

function useSourceFilterView(
  props: VacancySourceCatalogFilterProps,
  catalog: readonly VacancySourceRegistryEntry[],
) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SourceGroupSelection>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const options = useMemo(() => buildSourceOptions(props.facets, catalog), [props.facets, catalog]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((source) => {
    const inGroup = group === 'all' || source.groupId === group;
    return inGroup && source.searchableText.includes(normalizedQuery);
  });
  const visible = filtered.slice(0, visibleCount);
  const selected = props.state.sources ?? [];
  const allVisibleSelected =
    filtered.length > 0 && filtered.every(({ sourceId }) => selected.includes(sourceId));
  const toggleSource = (sourceId: string) => updateSelectedSource(props.onChange, sourceId);
  const toggleVisibleSources = () => {
    props.onChange((previous) => ({
      ...previous,
      sources: selectionAfterToggle(
        previous.sources ?? [],
        filtered.map(({ sourceId }) => sourceId),
      ),
    }));
  };
  return {
    query,
    setQuery,
    group,
    setGroup,
    options,
    filtered,
    visible,
    selected,
    allVisibleSelected,
    toggleSource,
    toggleVisibleSources,
    clearSources: () => props.onChange((previous) => ({ ...previous, sources: [] })),
    showMore: () => setVisibleCount((count) => count + 20),
    resetVisibleCount: () => setVisibleCount(20),
  };
}

function selectionAfterToggle(
  selected: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const next = new Set(selected);
  if (visibleIds.length > 0 && visibleIds.every((id) => next.has(id))) {
    for (const id of visibleIds) next.delete(id);
  } else {
    for (const id of visibleIds) next.add(id);
  }
  return [...next];
}

function SourceCatalogContent({
  facets,
  catalog,
  view,
}: {
  readonly facets: MatchedVacancyFacets;
  readonly catalog: ReturnType<typeof useSourceCatalog>;
  readonly view: ReturnType<typeof useSourceFilterView>;
}) {
  return (
    <div className="field-group vacancy-source-filter">
      <h4>Источники</h4>
      <SourceCatalogSearch
        count={view.options.length}
        value={view.query}
        onChange={(value) => {
          view.setQuery(value);
          view.resetVisibleCount();
        }}
      />
      <SourceCategoryFilters
        facets={facets}
        catalogCount={view.options.length}
        group={view.group}
        onSelect={(group) => {
          view.setGroup(group);
          view.resetVisibleCount();
        }}
      />
      <SourceOptionList
        catalog={catalog}
        sources={view.visible}
        total={view.filtered.length}
        visibleCount={view.visible.length}
        selectedSources={view.selected}
        onToggleSource={view.toggleSource}
        onShowMore={view.showMore}
      />
      <SourceSelectionActions
        selectedCount={view.selected.length}
        catalogCount={view.options.length}
        visibleCount={view.filtered.length}
        allVisibleSelected={view.allVisibleSelected}
        onToggleAll={view.toggleVisibleSources}
        onClear={view.clearSources}
      />
    </div>
  );
}

function SourceCatalogSearch({
  count,
  value,
  onChange,
}: {
  readonly count: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const label = `Найти среди ${count} источников: название, домен, страна`;
  return (
    <label className="career-field vacancy-source-search">
      <span className="career-sr-only">{label}</span>
      <input
        type="search"
        aria-label={label}
        placeholder="Найти по названию, домену или стране"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function SourceOptionButton({
  source,
  selected,
  onClick,
}: {
  readonly source: SourceOption;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip-btn vacancies-chip vacancy-facet-chip${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="vacancy-facet-chip-indicator" aria-hidden="true">
        {selected ? (
          <Check className="vacancy-facet-chip-check" weight="bold" aria-hidden="true" />
        ) : null}
      </span>
      <span className="vacancy-facet-chip-copy">
        <span>{source.name}</span>
        <span className="vacancy-facet-count">{source.count}</span>
      </span>
    </button>
  );
}
