import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import { FitDot } from './VacanciesScreen';
import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';
import { vacancyLevelMatchLabel } from './vacancyLevelMatch';

/**
 * Одна строка списка «Вакансии» (B248/B250): логотип-инициалы, заголовок и
 * подзаголовок компания/гео/формат, три fit-dot (роль/уровень/гео), вилка и
 * возраст записи. Клик открывает карточку в детальной панели — сама панель
 * это следующий срез, здесь только выделение строки.
 */
export function VacancyRow({
  item,
  now,
  isSelected,
  onSelect,
}: {
  readonly item: MatchedVacancyItem;
  readonly now: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  const { cluster, explanation } = item;
  const age = vacancyAge(cluster, now);
  return (
    <li className="vac-list-item">
      <button
        type="button"
        className={`vac-row${isSelected ? ' is-selected' : ''}`}
        aria-pressed={isSelected}
        onClick={onSelect}
      >
        <span className="vac-logo" aria-hidden="true">
          {logoInitials(cluster.canonicalCompany)}
        </span>
        <span className="vac-main">
          <span className="vac-title">{cluster.canonicalTitle}</span>
          <span className="vac-sub">{vacancySubtitle(cluster)}</span>
          <span className="vac-meta">
            <span className="vac-comp">{formatCompensationCompact(cluster.salary)}</span>
            <span className="vac-age">{age.label}</span>
            <span className="vac-fit">
              <FitDot isYes={explanation.roleMatch === 'target'} title="Семья ролей" />
              <VacancyLevelDot match={explanation.levelMatch} />
              <FitDot isYes={!explanation.outsideGeography} title="География" />
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function VacancyLevelDot({ match }: { readonly match: VacancyLevelMatch }) {
  const title = vacancyLevelMatchLabel(match);
  return (
    <FitDot
      isYes={match === 'match'}
      isUnknown={match === 'unknown'}
      title={title}
      ariaLabel={title}
    />
  );
}

function logoInitials(company: string): string {
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .filter(Boolean);
  return letters.slice(0, 2).join('') || '—';
}

function vacancySubtitle(cluster: MatchedVacancyItem['cluster']): string {
  const parts = [cluster.canonicalCompany, cluster.canonicalLocation].filter(Boolean);
  if (cluster.isRemote) parts.push('удалённо');
  return parts.join(' · ');
}
