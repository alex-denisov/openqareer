import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import type { VacancyLevelMatch, VacancyRoleMatch } from '../../../shared/vacancyMatchOrder';

/**
 * Одна строка списка «Вакансии» (B248/B250): логотип-инициалы, заголовок и
 * подзаголовок компания/гео/формат, три чипа статуса («Роль», «Уровень», «Гео»),
 * вилка и возраст записи.
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
            <VacancyFitChips explanation={explanation} />
          </span>
        </span>
      </button>
    </li>
  );
}

function VacancyFitChips({
  explanation,
}: {
  readonly explanation: MatchedVacancyItem['explanation'];
}) {
  const roleChip = roleChipDetails(explanation.roleMatch, explanation.adjacentRole);
  const levelChip = levelChipDetails(explanation.levelMatch);
  const geoChip = geoChipDetails(explanation.outsideGeography);

  return (
    <span className="vac-fit">
      <VacancyFitChip
        label="Роль"
        status={roleChip.status}
        tone={roleChip.tone}
        title={roleChip.title}
      />
      <VacancyFitChip
        label="Уровень"
        status={levelChip.status}
        tone={levelChip.tone}
        title={levelChip.title}
        ariaLabel={levelChip.title}
      />
      <VacancyFitChip
        label="Гео"
        status={geoChip.status}
        tone={geoChip.tone}
        title={geoChip.title}
      />
    </span>
  );
}

interface VacancyFitChipProps {
  readonly label: 'Роль' | 'Уровень' | 'Гео';
  readonly status: 'совпадает' | 'рядом' | 'смежная' | 'нет';
  readonly tone: 'yes' | 'nearby' | 'no' | 'unknown';
  readonly title: string;
  readonly ariaLabel?: string;
}

function VacancyFitChip({ label, status, tone, title, ariaLabel }: VacancyFitChipProps) {
  const toneClass =
    tone === 'yes'
      ? 'is-yes'
      : tone === 'nearby'
        ? 'is-nearby'
        : tone === 'unknown'
          ? 'is-unknown'
          : 'is-no';

  return (
    <span
      className={`vac-fit-chip fit-dot ${toneClass}`}
      title={title}
      aria-label={ariaLabel ?? `${label}: ${status}. ${title}`}
    >
      <span className="vac-fit-label">{label}</span>
      <span className="vac-fit-status">{status}</span>
    </span>
  );
}

function roleChipDetails(roleMatch: VacancyRoleMatch, adjacentRole?: boolean): {
  readonly status: 'совпадает' | 'рядом' | 'смежная' | 'нет';
  readonly tone: 'yes' | 'nearby' | 'no';
  readonly title: string;
} {
  if (adjacentRole) {
    return {
      status: 'смежная',
      tone: 'nearby',
      title: 'Смежная роль вне семейств кампании',
    };
  }
  if (roleMatch === 'target') {
    return { status: 'совпадает', tone: 'yes', title: 'Семья ролей: совпадает' };
  }
  if (roleMatch === 'partial') {
    return { status: 'рядом', tone: 'nearby', title: 'Функция совпадает, уровень рядом' };
  }
  return { status: 'нет', tone: 'no', title: 'Семья ролей: не совпадает' };
}

function levelChipDetails(levelMatch: VacancyLevelMatch): {
  readonly status: 'совпадает' | 'рядом' | 'нет';
  readonly tone: 'yes' | 'nearby' | 'no' | 'unknown';
  readonly title: string;
} {
  if (levelMatch === 'match') {
    return { status: 'совпадает', tone: 'yes', title: 'Уровень совпадает' };
  }
  if (levelMatch === 'below') {
    return { status: 'рядом', tone: 'nearby', title: 'Вакансия ниже целевого уровня' };
  }
  if (levelMatch === 'above') {
    return { status: 'рядом', tone: 'nearby', title: 'Вакансия выше целевого уровня' };
  }
  return { status: 'нет', tone: 'unknown', title: 'Уровень не распознан' };
}

function geoChipDetails(outsideGeography?: boolean): {
  readonly status: 'совпадает' | 'рядом' | 'нет';
  readonly tone: 'yes' | 'no';
  readonly title: string;
} {
  if (!outsideGeography) {
    return { status: 'совпадает', tone: 'yes', title: 'География: совпадает' };
  }
  return { status: 'нет', tone: 'no', title: 'География: не совпадает' };
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
