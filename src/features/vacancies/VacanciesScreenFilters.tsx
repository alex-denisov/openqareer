import { useState, type ReactNode } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { VacancyRow } from './VacancyRow';

export interface VacanciesScreenState {
  /** Пусто = «Все роли кампании» (по умолчанию); иначе — мультивыбор. */
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
}

export interface VacanciesScreenFiltersProps {
  readonly roleHypotheses: NonNullable<CampaignMetaView['roleHypotheses']>;
  readonly regions: readonly string[];
  readonly candidateLevel?: string | null;
  readonly state: VacanciesScreenState;
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly onReset: () => void;
}

const FRESHNESS_OPTIONS = [
  { days: 0, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
] as const;

export function VacanciesFilters(props: VacanciesScreenFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="vacancies-filter-column">
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary vacancies-mobile-filter-toggle"
        aria-label="Фильтры и сохранённые запросы"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Фильтры и запросы</span>
        <span aria-hidden="true">{expanded ? 'Скрыть' : 'Показать'}</span>
      </button>
      <aside
        className={`vacancies-filters${expanded ? ' is-mobile-open' : ''}`}
        aria-label="Фильтры"
      >
        <VacanciesFilterControls {...props} />
      </aside>
    </div>
  );
}

function VacanciesFilterControls({
  roleHypotheses,
  regions,
  candidateLevel,
  state,
  onChange,
  onReset,
}: VacanciesScreenFiltersProps) {
  return (
    <>
      <RoleHypothesesGroup roleHypotheses={roleHypotheses} state={state} onChange={onChange} />
      <RegionsGroup regions={regions} state={state} onChange={onChange} />
      <RemoteOnlyGroup state={state} onChange={onChange} />
      {candidateLevel ? (
        <FieldGroup title="Уровень">
          <Chip label={candidateLevel} isSelected />
        </FieldGroup>
      ) : null}
      <FreshnessGroup state={state} onChange={onChange} />
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary vacancies-reset"
        onClick={onReset}
      >
        Сбросить фильтры
      </button>
    </>
  );
}

function RemoteOnlyGroup({ state, onChange }: Pick<VacanciesScreenFiltersProps, 'state' | 'onChange'>) {
  return (
    <FieldGroup title="Формат работы">
      <Chip
        label="Удалённо"
        isSelected={state.remoteOnly}
        onClick={() => onChange((prev) => ({ ...prev, remoteOnly: !prev.remoteOnly }))}
      />
    </FieldGroup>
  );
}

interface FilterGroupProps {
  readonly state: VacanciesScreenState;
  readonly onChange: VacanciesScreenFiltersProps['onChange'];
}

function RoleHypothesesGroup({
  roleHypotheses,
  state,
  onChange,
}: FilterGroupProps & { readonly roleHypotheses: VacanciesScreenFiltersProps['roleHypotheses'] }) {
  if (roleHypotheses.length === 0) return null;
  return (
    <FieldGroup title="Роль кампании">
      <button
        type="button"
        className={`vacancies-chip vacancies-chip-accent${state.roles.length === 0 ? ' is-selected' : ''}`}
        aria-pressed={state.roles.length === 0}
        onClick={() => onChange((prev) => ({ ...prev, roles: [] }))}
      >
        Все роли кампании
      </button>
      {roleHypotheses.map((hypothesis) => (
        <RoleChip
          key={hypothesis.role}
          role={hypothesis.role}
          vacancyCount={hypothesis.vacancyCount}
          isHypothesis={hypothesis.isHypothesis}
          isSelected={state.roles.includes(hypothesis.role)}
          onSelect={() =>
            onChange((prev) => ({
              ...prev,
              roles: prev.roles.includes(hypothesis.role)
                ? prev.roles.filter((role) => role !== hypothesis.role)
                : [...prev.roles, hypothesis.role],
            }))
          }
        />
      ))}
    </FieldGroup>
  );
}

function RegionsGroup({
  regions,
  state,
  onChange,
}: FilterGroupProps & { readonly regions: readonly string[] }) {
  if (regions.length === 0) return null;
  return (
    <FieldGroup title="География">
      {regions.map((region) => (
        <Chip
          key={region}
          label={region}
          isSelected={state.regions.includes(region)}
          onClick={() =>
            onChange((prev) => ({
              ...prev,
              regions: prev.regions.includes(region)
                ? prev.regions.filter((entry) => entry !== region)
                : [...prev.regions, region],
            }))
          }
        />
      ))}
    </FieldGroup>
  );
}

function FreshnessGroup({ state, onChange }: FilterGroupProps) {
  return (
    <FieldGroup title="Свежесть">
      {FRESHNESS_OPTIONS.map((option) => (
        <Chip
          key={option.days}
          label={option.label}
          isSelected={state.freshnessDays === option.days}
          onClick={() =>
            onChange((prev) => ({
              ...prev,
              freshnessDays: prev.freshnessDays === option.days ? undefined : option.days,
            }))
          }
        />
      ))}
    </FieldGroup>
  );
}

function FieldGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="vacancies-field-group">
      <h3>{title}</h3>
      <div className="vacancies-chip-row">{children}</div>
    </div>
  );
}

export function VacanciesList({
  total,
  items,
  now,
  selectedId,
  onSelect,
  onReset,
}: {
  readonly total: number;
  readonly items: readonly MatchedVacancyItem[];
  readonly now: string;
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  readonly onReset: () => void;
}) {
  return (
    <section className="vacancies-list-col" aria-label="Список вакансий">
      <div className="vacancies-list-head">
        <span className="vacancies-list-hint">
          {pluralRu(total, ['вакансия', 'вакансии', 'вакансий'])} · показаны совпадающие по роли и
          уровню
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="vac-list">
          {items.map((item) => (
            <VacancyRow
              key={item.cluster.id}
              item={item}
              now={now}
              isSelected={selectedId === item.cluster.id}
              onSelect={() => onSelect(item.cluster.id)}
            />
          ))}
        </ul>
      ) : (
        <div className="vacancies-filter-empty">
          <p>По выбранной роли и фильтрам совпадающих вакансий нет.</p>
          <button type="button" className="vacancies-btn vacancies-btn-secondary" onClick={onReset}>
            Сбросить фильтры
          </button>
        </div>
      )}
    </section>
  );
}

function Chip({
  label,
  isSelected,
  onClick,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onClick?: () => void;
}) {
  if (!onClick) return <span className={`vacancies-chip${isSelected ? ' is-selected' : ''}`}>{label}</span>;
  return (
    <button
      type="button"
      className={`vacancies-chip${isSelected ? ' is-selected' : ''}`}
      aria-pressed={isSelected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RoleChip({
  role,
  vacancyCount,
  isHypothesis,
  isSelected,
  onSelect,
}: {
  readonly role: string;
  readonly vacancyCount: number;
  readonly isHypothesis: boolean;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`vacancies-chip vacancies-chip-accent${isSelected ? ' is-selected' : ''}${
        isHypothesis ? ' vacancies-chip-hypothesis' : ''
      }`}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      {role} ({vacancyCount}){isHypothesis ? ' — гипотеза' : ''}
    </button>
  );
}
