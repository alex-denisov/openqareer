import { useMemo, useState, type ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { titleMatchesRole } from '../../../shared/vacancyRoleTitleMatch';
import { vacancyAge } from './vacancyFilters';
import { VacancyRow } from './VacancyRow';

const FRESHNESS_OPTIONS = [
  { days: 0, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
] as const;

export interface VacanciesScreenState {
  readonly role?: string;
  readonly regions: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
}

const EMPTY_STATE: VacanciesScreenState = { regions: [], remoteOnly: false };

/**
 * «Вакансии» (B248/B250) — верх экрана и список пула.
 *
 * Роль кампании и её гипотезы, уровень кандидата и счётчик по каждой роли уже
 * едут с первой страницей пула (B247, срез 2); экран их только показывает и
 * фильтрует список тем же признаком `titleMatchesRole`, что и сервер, чтобы
 * баннер и список не расходились в счёте.
 */
export function VacanciesScreen({
  matched,
  total,
  campaign,
  candidateLevel,
  now = new Date().toISOString(),
}: {
  readonly matched: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly campaign?: CampaignMetaView;
  readonly candidateLevel?: string | null;
  readonly now?: string;
}) {
  const roles = campaign?.roles.value ?? [];
  const regions = campaign?.regions.value ?? [];
  const [state, setState] = useState<VacanciesScreenState>({
    ...EMPTY_STATE,
    role: roles[0],
    regions,
  });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const filtered = useMemo(
    () => filterByScreenState(matched, state, now),
    [matched, state, now],
  );

  const roleHypotheses = campaign?.roleHypotheses ?? [];
  const primaryRole = state.role ?? roles[0];

  return (
    <div className="vacancies-screen">
      <header className="career-view-heading">
        <div>
          <p className="career-eyebrow">
            {primaryRole ? `Кампания · ${primaryRole}` : 'Кампания'}
          </p>
          <h1>Вакансии</h1>
          <p className="vacancies-desc">
            Отсортировано по совпадению с профилем. Откройте карточку — решение «Откликнуться»
            принимается там же, без перехода на площадку.
          </p>
        </div>
      </header>

      <div className="vacancies-layout">
        <aside className="vacancies-filters" aria-label="Фильтры">
          {roleHypotheses.length > 0 ? (
            <FieldGroup title="Роль кампании">
              {roleHypotheses.map((hypothesis) => (
                <RoleChip
                  key={hypothesis.role}
                  role={hypothesis.role}
                  isHypothesis={hypothesis.isHypothesis}
                  isSelected={state.role === hypothesis.role}
                  onSelect={() => setState((prev) => ({ ...prev, role: hypothesis.role }))}
                />
              ))}
            </FieldGroup>
          ) : null}

          {regions.length > 0 ? (
            <FieldGroup title="География">
              {regions.map((region) => (
                <Chip
                  key={region}
                  label={region}
                  isSelected={state.regions.includes(region)}
                  onClick={() =>
                    setState((prev) => ({ ...prev, regions: toggleRegion(prev.regions, region) }))
                  }
                />
              ))}
              <Chip
                label="Удалённо"
                isSelected={state.remoteOnly}
                onClick={() => setState((prev) => ({ ...prev, remoteOnly: !prev.remoteOnly }))}
              />
            </FieldGroup>
          ) : null}

          {candidateLevel ? (
            <FieldGroup title="Уровень">
              <Chip label={candidateLevel} isSelected />
            </FieldGroup>
          ) : null}

          <FieldGroup title="Свежесть">
            {FRESHNESS_OPTIONS.map((option) => (
              <Chip
                key={option.days}
                label={option.label}
                isSelected={state.freshnessDays === option.days}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    freshnessDays: prev.freshnessDays === option.days ? undefined : option.days,
                  }))
                }
              />
            ))}
          </FieldGroup>

          <button
            type="button"
            className="btn btn-ghost btn-sm vacancies-reset"
            onClick={() => setState({ ...EMPTY_STATE, role: roles[0], regions })}
          >
            Сбросить фильтры
          </button>
        </aside>

        <section className="vacancies-list-col" aria-label="Список вакансий">
          <div className="vacancies-list-head">
            <span className="vacancies-list-hint">
              {total} {total === 1 ? 'вакансия' : 'вакансий'} · показаны совпадающие по роли и
              уровню
            </span>
          </div>
          <ul className="vac-list">
            {filtered.map((item) => (
              <VacancyRow
                key={item.cluster.id}
                item={item}
                now={now}
                isSelected={selectedId === item.cluster.id}
                onSelect={() => setSelectedId(item.cluster.id)}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function toggleRegion(regions: readonly string[], region: string): readonly string[] {
  return regions.includes(region)
    ? regions.filter((entry) => entry !== region)
    : [...regions, region];
}

function filterByScreenState(
  items: readonly MatchedVacancyItem[],
  state: VacanciesScreenState,
  now: string,
): MatchedVacancyItem[] {
  return items.filter(({ cluster }) => {
    if (state.role && !titleMatchesRole(cluster.canonicalTitle, state.role)) return false;
    if (state.remoteOnly && !cluster.isRemote) return false;
    if (state.regions.length > 0 && !state.remoteOnly) {
      const location = cluster.canonicalLocation?.toLocaleLowerCase('ru-RU') ?? '';
      const inRegion = state.regions.some((region) =>
        location.includes(region.toLocaleLowerCase('ru-RU')),
      );
      if (!inRegion && !cluster.isRemote) return false;
    }
    if (state.freshnessDays !== undefined) {
      const { days } = vacancyAge(cluster, now);
      if (days === null || days > state.freshnessDays) return false;
    }
    return true;
  });
}

function FieldGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="vacancies-field-group">
      <h3>{title}</h3>
      <div className="vacancies-chip-row">{children}</div>
    </div>
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
  return (
    <button
      type="button"
      className={`vacancies-chip${isSelected ? ' is-selected' : ''}`}
      aria-pressed={isSelected}
      onClick={onClick}
      disabled={!onClick}
    >
      {label}
    </button>
  );
}

function RoleChip({
  role,
  isHypothesis,
  isSelected,
  onSelect,
}: {
  readonly role: string;
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
      {role}
      {isHypothesis ? ' — гипотеза' : ''}
    </button>
  );
}

/** Единственная точка «есть совпадение» на всех трёх fit-dots (B248). */
export function FitDot({ isYes, title }: { readonly isYes: boolean; readonly title: string }) {
  return (
    <span className={`fit-dot${isYes ? ' is-yes' : ' is-no'}`} title={title}>
      {isYes ? <Check weight="bold" size={11} /> : '—'}
    </span>
  );
}
