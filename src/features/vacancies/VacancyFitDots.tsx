import type { ReactNode } from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { CareerTooltip } from '../shell/CareerTooltip';

function WaveIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M3 9c3-3 6-3 9 0s6 3 9 0M3 16c3-3 6-3 9 0s6 3 9 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="24" aria-hidden="true">
      <path d="M216 72 104 184l-56-56" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

function FitDotView({
  className,
  label,
  tooltip,
  icon,
}: {
  readonly className: string;
  readonly label: string;
  readonly tooltip: string;
  readonly icon: ReactNode;
}) {
  return (
    <CareerTooltip content={tooltip}>
      <span className={className} role="img" aria-label={label}>
        {icon}
      </span>
    </CareerTooltip>
  );
}

export function RoleFitDot({
  roleMatch,
  adjacent,
}: {
  readonly roleMatch: MatchedVacancyItem['explanation']['roleMatch'];
  readonly adjacent?: boolean;
}) {
  if (adjacent) {
    return (
      <FitDotView
        className="fit-dot is-nearby"
        label="Роль: рядом. Смежная роль вне семейств кампании"
        tooltip="Роль: смежная (рядом)"
        icon={<WaveIcon />}
      />
    );
  }
  if (roleMatch === 'target') {
    return (
      <FitDotView
        className="fit-dot is-yes"
        label="Роль: совпадает"
        tooltip="Роль: совпадает"
        icon={<CheckIcon />}
      />
    );
  }
  if (roleMatch === 'partial') {
    return (
      <FitDotView
        className="fit-dot is-nearby"
        label="Роль: рядом. Функция совпадает, уровень рядом"
        tooltip="Роль: рядом"
        icon={<WaveIcon />}
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="Роль: не совпадает"
      tooltip="Роль: не совпадает"
      icon={<DashIcon />}
    />
  );
}

export function LevelFitDot({
  levelMatch,
}: {
  readonly levelMatch: MatchedVacancyItem['explanation']['levelMatch'];
}) {
  if (levelMatch === 'match') {
    return (
      <FitDotView
        className="fit-dot is-yes"
        label="Уровень: совпадает"
        tooltip="Уровень: совпадает"
        icon={<CheckIcon />}
      />
    );
  }
  if (levelMatch === 'below' || levelMatch === 'above') {
    const desc =
      levelMatch === 'below'
        ? 'Вакансия ниже целевого уровня'
        : 'Вакансия выше целевого уровня';
    return (
      <FitDotView
        className="fit-dot is-nearby"
        label={`Уровень: рядом. ${desc}`}
        tooltip="Уровень: рядом"
        icon={<WaveIcon />}
      />
    );
  }
  if (levelMatch === 'unknown') {
    return (
      <FitDotView
        className="fit-dot is-unknown"
        label="Уровень не распознан"
        tooltip="Уровень не распознан"
        icon="?"
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="Уровень: не совпадает"
      tooltip="Уровень: не совпадает"
      icon={<DashIcon />}
    />
  );
}

export function GeoFitDot({ outsideGeo }: { readonly outsideGeo?: boolean }) {
  if (!outsideGeo) {
    return (
      <FitDotView
        className="fit-dot is-yes"
        label="География: совпадает"
        tooltip="География: совпадает"
        icon={<CheckIcon />}
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="География: не совпадает"
      tooltip="География: не совпадает"
      icon={<DashIcon />}
    />
  );
}
