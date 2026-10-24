import { useEffect, useRef, useState } from 'react';
import { CaretDown, Check, Funnel, Globe } from '@phosphor-icons/react';

import {
  locationNodeState,
  searchLocationTree,
  selectedVacancyCount,
  toggleLocationNode,
  type LocationNodeState,
  type LocationTree,
  type LocationTreeNode,
} from '../../../shared/locationTree';
import { HOME_COUNTRY } from '../../../shared/locationGazetteer';
import type { VacanciesScreenState } from './vacanciesScreenState';
import { useRelocationSetting } from './useRelocationSetting';
import { selectedLocationVacancies } from './campaignLocationSelection';
import './vacancy-location-tree.css';

const PAGE = 4;
const PAGE_STEP = 20;
const numberFormat = new Intl.NumberFormat('ru-RU');

export interface VacancyLocationTreeFilterProps {
  readonly state: VacanciesScreenState;
  readonly tree: LocationTree;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onCancel: () => void;
  readonly onApply: () => void;
  /** Свой подвал только у поповера «Локации»; в общем листе фильтров — общий. */
  readonly withFooter?: boolean;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function moreLabel(count: number, kind: 'city' | 'region' | 'country', country: string): string {
  if (kind === 'country') return `Ещё ${count} ${plural(count, 'страна', 'страны', 'стран')}`;
  if (kind === 'city') return `Ещё ${count} ${plural(count, 'город', 'города', 'городов')}`;
  if (country === 'США') return `Ещё ${count} ${plural(count, 'штат', 'штата', 'штатов')}`;
  return `Ещё ${count} ${plural(count, 'регион', 'региона', 'регионов')}`;
}

function TriStateCheckbox({
  state,
  disabled,
  label,
  onToggle,
}: {
  readonly state: LocationNodeState;
  readonly disabled?: boolean;
  readonly label: React.ReactNode;
  readonly onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'mixed';
  }, [state]);
  return (
    <label className="career-checkbox-label vacancy-location-check">
      <input
        ref={ref}
        type="checkbox"
        className="career-checkbox"
        checked={state === 'checked'}
        aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="vacancy-location-name">{label}</span>
    </label>
  );
}

function nodeCount(node: LocationTreeNode, selected: readonly string[]): string {
  const state = locationNodeState(node, selected);
  if (state !== 'mixed') return numberFormat.format(node.count);
  return `${numberFormat.format(selectedVacancyCount(node, selected))} из ${numberFormat.format(node.count)}`;
}

interface TreeContext {
  readonly tree: LocationTree;
  readonly selected: readonly string[];
  readonly foreignEnabled: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly onExpand: (key: string) => void;
  readonly onToggle: (node: LocationTreeNode) => void;
}

function NodeList({
  nodes,
  kind,
  country,
  context,
}: {
  readonly nodes: readonly LocationTreeNode[];
  readonly kind: 'city' | 'region' | 'country';
  readonly country: string;
  readonly context: TreeContext;
}) {
  const [limit, setLimit] = useState(PAGE);
  const rest = nodes.length - limit;
  return (
    <>
      {nodes.slice(0, limit).map((node) => (
        <TreeNode key={node.key} node={node} context={context} />
      ))}
      {rest > 0 ? (
        <li className="vacancy-location-more">
          <button
            type="button"
            className="vac-sm is-ghost"
            onClick={() => setLimit((value) => value + PAGE_STEP)}
          >
            {moreLabel(rest, kind, country)}
          </button>
        </li>
      ) : null}
    </>
  );
}

function NodeCaret({
  node,
  open,
  onExpand,
}: {
  readonly node: LocationTreeNode;
  readonly open: boolean;
  readonly onExpand: (key: string) => void;
}) {
  if (!node.children.length) return <span className="vacancy-location-spacer" />;
  return (
    <button
      type="button"
      className="vacancy-location-caret"
      aria-expanded={open}
      aria-label={`${open ? 'Свернуть' : 'Развернуть'} ${node.label}`}
      onClick={() => onExpand(node.key)}
    >
      <CaretDown size={16} aria-hidden="true" />
    </button>
  );
}

function TreeNode({
  node,
  context,
}: {
  readonly node: LocationTreeNode;
  readonly context: TreeContext;
}) {
  const open = context.expanded.has(node.key);
  const disabled = node.country !== HOME_COUNTRY && !context.foreignEnabled;
  const childKind = node.kind === 'country' ? 'region' : 'city';
  const visibleChildren = node.children;
  return (
    <li className="vacancy-location-node">
      <div className="vacancy-location-row">
        <NodeCaret node={node} open={open} onExpand={context.onExpand} />
        <TriStateCheckbox
          state={locationNodeState(node, context.selected)}
          disabled={disabled}
          label={node.label}
          onToggle={() => context.onToggle(node)}
        />
        {node.kind === 'country' && node.country !== HOME_COUNTRY && visibleChildren.length ? (
          <span className="vacancy-location-sub">
            {node.country === 'США' ? 'штаты' : 'регионы'}
          </span>
        ) : null}
        <span className="vacancy-location-count">{nodeCount(node, context.selected)}</span>
      </div>
      {open && visibleChildren.length ? (
        <ul className="vacancy-location-kids">
          <NodeList
            nodes={visibleChildren}
            kind={childKind}
            country={node.country}
            context={context}
          />
        </ul>
      ) : null}
    </li>
  );
}

function ForeignNote({
  onEnable,
  busy,
}: {
  readonly onEnable: () => void;
  readonly busy: boolean;
}) {
  return (
    <li className="vacancy-location-note">
      <Globe size={16} aria-hidden="true" />
      <span>Другие страны: подборка учтёт их после включения релокации.</span>
      <button type="button" className="vac-sm is-ghost" disabled={busy} onClick={onEnable}>
        Включить
      </button>
    </li>
  );
}

function RemoteRow({
  state,
  count,
  onChange,
}: Pick<VacancyLocationTreeFilterProps, 'state' | 'onChange'> & { readonly count: number }) {
  return (
    <li className="vacancy-location-node">
      <div className="vacancy-location-row">
        <span className="vacancy-location-spacer" />
        <TriStateCheckbox
          state={state.locationRemote ? 'checked' : 'none'}
          label="Удалённо, из любой страны"
          onToggle={() => onChange((prev) => ({ ...prev, locationRemote: !prev.locationRemote }))}
        />
        <span className="vacancy-location-count">{numberFormat.format(count)}</span>
      </div>
    </li>
  );
}

function SearchResults({
  query,
  context,
  relocation,
}: {
  readonly query: string;
  readonly context: TreeContext;
  readonly relocation: ReturnType<typeof useRelocationSetting>;
}) {
  const hits = searchLocationTree(context.tree, query);
  const foreignLocked =
    !relocation.enabled && hits.some((hit) => hit.node.country !== HOME_COUNTRY);
  return (
    <>
      <p className="vacancy-location-found">
        {hits.length
          ? `Найдено ${hits.length} по «${query.trim()}»`
          : `Ничего не найдено по «${query.trim()}»`}
      </p>
      <ul className="vacancy-location-tree" aria-label="Найденные локации">
        {foreignLocked ? (
          <ForeignNote onEnable={relocation.enable} busy={relocation.saving} />
        ) : null}
        {hits.map((hit) => (
          <li key={hit.node.key} className="vacancy-location-hit">
            <div className="vacancy-location-row is-hit">
              <TriStateCheckbox
                state={locationNodeState(hit.node, context.selected)}
                disabled={hit.node.country !== HOME_COUNTRY && !context.foreignEnabled}
                label={
                  <>
                    {hit.node.label} <span className="vacancy-location-sub">{hit.kindLabel}</span>
                  </>
                }
                onToggle={() => context.onToggle(hit.node)}
              />
              <span className="vacancy-location-count">{numberFormat.format(hit.node.count)}</span>
            </div>
            {hit.path ? <span className="vacancy-location-path">{hit.path}</span> : null}
          </li>
        ))}
      </ul>
      <p className="vacancy-location-hint">
        Отметив штат или регион, вы выбираете все его города сразу.
      </p>
    </>
  );
}

function initialExpanded(tree: LocationTree): Set<string> {
  const home = tree.countries.find((node) => node.label === HOME_COUNTRY) ?? tree.countries[0];
  const keys = new Set<string>();
  if (home) keys.add(home.key);
  if (home?.children[0]) keys.add(home.children[0].key);
  return keys;
}

function TreeBody({
  props,
  context,
  relocation,
}: {
  readonly props: VacancyLocationTreeFilterProps;
  readonly context: TreeContext;
  readonly relocation: ReturnType<typeof useRelocationSetting>;
}) {
  const home = props.tree.countries.filter((node) => node.country === HOME_COUNTRY);
  const foreign = props.tree.countries.filter((node) => node.country !== HOME_COUNTRY);
  if (!props.tree.countries.length && !props.tree.remote)
    return <p className="vacancy-location-found">В выдаче нет вакансий с указанным местом.</p>;
  return (
    <ul className="vacancy-location-tree" aria-label="Локации">
      <RemoteRow state={props.state} count={props.tree.remote} onChange={props.onChange} />
      {home.map((node) => (
        <TreeNode key={node.key} node={node} context={context} />
      ))}
      {foreign.length && !relocation.enabled ? (
        <ForeignNote onEnable={relocation.enable} busy={relocation.saving} />
      ) : null}
      <NodeList nodes={foreign} kind="country" country="" context={context} />
    </ul>
  );
}

function LocationFooter({
  props,
  chosen,
  hasSelection,
}: {
  readonly props: VacancyLocationTreeFilterProps;
  readonly chosen: number;
  readonly hasSelection: boolean;
}) {
  return (
    <div className="vacancy-location-foot">
      <span className="vacancy-location-chosen">Выбрано {numberFormat.format(chosen)}</span>
      <button
        type="button"
        className="vac-sm is-ghost"
        disabled={!hasSelection}
        onClick={() =>
          props.onChange((prev) => ({
            ...prev,
            selectedLocations: [],
            locationRemote: false,
            regions: [],
          }))
        }
      >
        Снять все
      </button>
      <button type="button" className="vac-sm is-ghost" onClick={props.onCancel}>
        Отмена
      </button>
      <button type="button" className="vac-sm vacancies-filter-apply" onClick={props.onApply}>
        <Check size={16} weight="bold" aria-hidden="true" />
        Применить
      </button>
    </div>
  );
}

function LocationSearch({
  query,
  onQuery,
}: {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}) {
  return (
    <div className="vacancy-location-head">
      <label className="vacancy-location-search">
        <Funnel size={16} aria-hidden="true" />
        <span className="career-sr-only">Поиск локации</span>
        <input
          type="search"
          className="career-input"
          placeholder="Страна, регион, штат или город"
          aria-label="Страна, регион, штат или город"
          value={query}
          onChange={(event) => onQuery(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

export function VacancyLocationTreeFilter(props: VacancyLocationTreeFilterProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => initialExpanded(props.tree));
  const relocation = useRelocationSetting();
  const selected = props.state.selectedLocations ?? [];
  const context: TreeContext = {
    tree: props.tree,
    selected,
    foreignEnabled: relocation.enabled,
    expanded,
    onExpand: (key) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    onToggle: (node) =>
      props.onChange((prev) => ({
        ...prev,
        selectedLocations: toggleLocationNode(prev.selectedLocations ?? [], node, props.tree),
      })),
  };
  const chosen = selectedLocationVacancies(props.tree, props.state);
  return (
    <div className="vacancy-location-filter" data-testid="location-tree-filter">
      <LocationSearch query={query} onQuery={setQuery} />
      <div className="vacancy-location-body">
        {query.trim() ? (
          <SearchResults query={query} context={context} relocation={relocation} />
        ) : (
          <TreeBody props={props} context={context} relocation={relocation} />
        )}
        {relocation.error ? (
          <p className="vacancy-location-found" role="alert">
            {relocation.error}
          </p>
        ) : null}
      </div>
      {props.withFooter === false ? null : (
        <LocationFooter
          props={props}
          chosen={chosen}
          hasSelection={selected.length > 0 || Boolean(props.state.locationRemote)}
        />
      )}
    </div>
  );
}
