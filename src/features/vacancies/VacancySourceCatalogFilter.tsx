import { useEffect, useMemo, useState } from 'react';
import { Check, Funnel } from '@phosphor-icons/react';
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
  /** Свой подвал только у поповера 1440; на push-экране 390 — «Показать N» листа. */
  readonly withFooter?: boolean;
  readonly onCancel?: () => void;
  readonly onApply?: () => void;
}

interface SourceOption {
  readonly sourceId: string;
  readonly name: string;
  readonly count: number;
  readonly groupId: MatchedVacancySourceGroupId | null;
  readonly market?: string;
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
  return <SourceCatalogContent props={props} catalog={catalog} view={view} />;
}

export function useSourceCatalog() {
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

const sourceNameKey = (name: string) =>
  name
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim()
    .toLocaleLowerCase();

/**
 * B446-r (W7): id реестра и id источника выдачи расходятся («indeed» и
 * «src-indeed»), поэтому счёт сводится по id или по имени без пометки канала.
 * Источники с вакансиями выдачи идут первыми — как в макете «5 120, 2 310…».
 */
export function buildSourceOptions(
  facets: MatchedVacancyFacets,
  catalog: readonly VacancySourceRegistryEntry[],
): SourceOption[] {
  const byId = new Map(facets.sources.map((source) => [source.sourceId, source]));
  const byName = new Map(facets.sources.map((source) => [sourceNameKey(source.name), source]));
  const used = new Set<string>();
  const fromCatalog = catalog.map((source) => {
    const facet = byId.get(source.id) ?? byName.get(sourceNameKey(source.name));
    if (facet) used.add(facet.sourceId);
    const categoryGroup = source.category ? SOURCE_GROUP_BY_CATEGORY[source.category] : undefined;
    return {
      sourceId: facet?.sourceId ?? source.id,
      name: source.name,
      count: facet?.count ?? 0,
      groupId: categoryGroup ?? facet?.groupId ?? null,
      market: source.market,
      searchableText: sourceSearchText(source),
    };
  });
  const fromFacets = facets.sources
    .filter(({ sourceId }) => !used.has(sourceId))
    .map(({ sourceId, name, count, groupId }) => ({
      sourceId,
      name: name.replace(/\s*\(страница поиска\)$/u, ''),
      count,
      groupId: groupId ?? null,
      searchableText: [sourceId, name].join(' ').toLocaleLowerCase(),
    }));
  return [...fromCatalog, ...fromFacets]
    .map((option, index) => ({ option, index }))
    .sort((a, b) => b.option.count - a.option.count || a.index - b.index)
    .map(({ option }) => option);
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

const numberFormat = new Intl.NumberFormat('ru-RU');

/** Категории со счётом источников каталога, а не вакансий (B547 / возврат B447). */
function SourceCategoryFilters({
  options,
  group,
  onSelect,
}: {
  readonly options: readonly SourceOption[];
  readonly group: SourceGroupSelection;
  readonly onSelect: (group: SourceGroupSelection) => void;
}) {
  const groups = [
    { id: 'all' as const, name: 'Все', count: options.length },
    ...MATCHED_VACANCY_SOURCE_GROUPS.map((sourceGroup) => ({
      ...sourceGroup,
      count: options.filter(({ groupId }) => groupId === sourceGroup.id).length,
    })),
  ];
  return (
    <div className="vacancy-source-categories" role="group" aria-label="Категории источников">
      {groups.map((sourceGroup) => (
        <button
          key={sourceGroup.id}
          type="button"
          className="vacancy-source-category"
          aria-pressed={group === sourceGroup.id}
          onClick={() => onSelect(sourceGroup.id)}
        >
          {sourceGroup.name}
          <span className="vacancy-location-count">{numberFormat.format(sourceGroup.count)}</span>
        </button>
      ))}
    </div>
  );
}

function SourceRow({
  source,
  selected,
  onToggle,
}: {
  readonly source: SourceOption;
  readonly selected: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="vacancy-location-node">
      <div className="vacancy-location-row">
        <span className="vacancy-location-spacer" />
        <label className="career-checkbox-label vacancy-location-check">
          <input
            type="checkbox"
            className="career-checkbox"
            checked={selected}
            onChange={onToggle}
          />
          <span className="vacancy-location-name">{source.name}</span>
        </label>
        <span className="vacancy-location-sub">{source.market ?? ''}</span>
        <span className="vacancy-location-count">{numberFormat.format(source.count)}</span>
      </div>
    </li>
  );
}

function CategoryAllRow({
  name,
  view,
}: {
  readonly name: string;
  readonly view: ReturnType<typeof useSourceFilterView>;
}) {
  const ids = view.filtered.map(({ sourceId }) => sourceId);
  const chosen = ids.filter((id) => view.selected.includes(id)).length;
  return (
    <li className="vacancy-location-node">
      <div className="vacancy-location-row">
        <span className="vacancy-location-spacer" />
        <label className="career-checkbox-label vacancy-location-check">
          <input
            type="checkbox"
            className="career-checkbox"
            checked={ids.length > 0 && chosen === ids.length}
            ref={(input) => {
              if (input) input.indeterminate = chosen > 0 && chosen < ids.length;
            }}
            disabled={!ids.length}
            onChange={view.toggleVisibleSources}
          />
          <span className="vacancy-location-name">Все в «{name}»</span>
        </label>
        <span className="vacancy-location-count">{numberFormat.format(ids.length)}</span>
      </div>
    </li>
  );
}

function SourceOptionList({
  catalog,
  view,
}: {
  readonly catalog: ReturnType<typeof useSourceCatalog>;
  readonly view: ReturnType<typeof useSourceFilterView>;
}) {
  const groupName = MATCHED_VACANCY_SOURCE_GROUPS.find(({ id }) => id === view.group)?.name;
  return (
    <div className="vacancy-location-body vacancy-source-group">
      {catalog.loading ? <p role="status">Загружаем каталог источников…</p> : null}
      {catalog.failed ? (
        <p role="status">Каталог не загрузился. Показаны источники из текущей подборки.</p>
      ) : null}
      <ul className="vacancy-location-tree" aria-label="Источники">
        {groupName ? <CategoryAllRow name={groupName} view={view} /> : null}
        {view.visible.map((source) => (
          <SourceRow
            key={source.sourceId}
            source={source}
            selected={view.selected.includes(source.sourceId)}
            onToggle={() => view.toggleSource(source.sourceId)}
          />
        ))}
      </ul>
      {view.filtered.length === 0 && !catalog.loading ? (
        <p role="status" className="vacancy-location-found">
          Источников по этому запросу нет.
        </p>
      ) : null}
      {view.visible.length < view.filtered.length ? (
        <button
          type="button"
          className="vac-sm is-ghost vacancy-location-more"
          onClick={view.showMore}
        >
          Показать ещё 20
        </button>
      ) : null}
    </div>
  );
}

function SourceFooter({
  view,
  compact,
  onCancel,
  onApply,
}: {
  readonly view: ReturnType<typeof useSourceFilterView>;
  readonly compact: boolean;
  readonly onCancel?: () => void;
  readonly onApply?: () => void;
}) {
  const total = numberFormat.format(view.options.length);
  return (
    <div className="vacancy-location-foot" role="group" aria-label="Выбор источников">
      <span className="vacancy-location-chosen" aria-live="polite">
        Выбрано {numberFormat.format(view.selected.length)} из {total}
      </span>
      <button type="button" className="vac-sm is-ghost" onClick={view.selectAll}>
        Все {total}
      </button>
      <button
        type="button"
        className="vac-sm is-ghost"
        disabled={!view.selected.length}
        onClick={view.clearSources}
      >
        Снять все
      </button>
      {compact ? null : (
        <>
          <button type="button" className="vac-sm is-ghost" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="vac-sm vacancies-filter-apply" onClick={onApply}>
            <Check size={16} weight="bold" aria-hidden="true" />
            Применить
          </button>
        </>
      )}
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
    selectAll: () =>
      props.onChange((previous) => ({
        ...previous,
        sources: options.map(({ sourceId }) => sourceId),
      })),
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
  props,
  catalog,
  view,
}: {
  readonly props: VacancySourceCatalogFilterProps;
  readonly catalog: ReturnType<typeof useSourceCatalog>;
  readonly view: ReturnType<typeof useSourceFilterView>;
}) {
  return (
    <div className="vacancy-location-filter vacancy-source-filter">
      <div className="vacancy-location-head">
        <SourceCatalogSearch
          count={view.options.length}
          value={view.query}
          onChange={(value) => {
            view.setQuery(value);
            view.resetVisibleCount();
          }}
        />
        <SourceCategoryFilters
          options={view.options}
          group={view.group}
          onSelect={(group) => {
            view.setGroup(group);
            view.resetVisibleCount();
          }}
        />
      </div>
      <SourceOptionList catalog={catalog} view={view} />
      <SourceFooter
        view={view}
        compact={!props.withFooter}
        onCancel={props.onCancel}
        onApply={props.onApply}
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
  const label = `Найти среди ${numberFormat.format(count)}: название, домен, страна`;
  return (
    <label className="vacancy-location-search vacancy-source-search">
      <Funnel size={16} aria-hidden="true" />
      <input
        type="search"
        className="career-input"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}
