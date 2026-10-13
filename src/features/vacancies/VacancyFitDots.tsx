import type { ReactNode } from 'react';
import { CheckCircle, Question, WaveSine, XCircle } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { CareerTooltip } from '../shell/CareerTooltip';

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
        icon={<WaveSine className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  if (roleMatch === 'target') {
    return (
      <FitDotView
        className="fit-dot is-yes"
        label="Роль: совпадает"
        tooltip="Роль: совпадает"
        icon={<CheckCircle className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  if (roleMatch === 'partial') {
    return (
      <FitDotView
        className="fit-dot is-nearby"
        label="Роль: рядом. Функция совпадает, уровень рядом"
        tooltip="Роль: рядом"
        icon={<WaveSine className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="Роль: не совпадает"
      tooltip="Роль: не совпадает"
      icon={<XCircle className="fit-dot-icon" aria-hidden="true" />}
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
        icon={<CheckCircle className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  if (levelMatch === 'below' || levelMatch === 'above') {
    const desc =
      levelMatch === 'below' ? 'Вакансия ниже целевого уровня' : 'Вакансия выше целевого уровня';
    return (
      <FitDotView
        className="fit-dot is-nearby"
        label={`Уровень: рядом. ${desc}`}
        tooltip="Уровень: рядом"
        icon={<WaveSine className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  if (levelMatch === 'unknown') {
    return (
      <FitDotView
        className="fit-dot is-unknown"
        label="Уровень не распознан"
        tooltip="Уровень не распознан"
        icon={<Question className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="Уровень: не совпадает"
      tooltip="Уровень: не совпадает"
      icon={<XCircle className="fit-dot-icon" aria-hidden="true" />}
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
        icon={<CheckCircle className="fit-dot-icon" aria-hidden="true" />}
      />
    );
  }
  return (
    <FitDotView
      className="fit-dot is-no"
      label="География: не совпадает"
      tooltip="География: не совпадает"
      icon={<XCircle className="fit-dot-icon" aria-hidden="true" />}
    />
  );
}
