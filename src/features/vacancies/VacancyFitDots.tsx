import type { MatchedVacancyItem } from '../coach/cabinetTypes';

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

export function RoleFitDot({
  roleMatch,
  adjacent,
}: {
  readonly roleMatch: MatchedVacancyItem['explanation']['roleMatch'];
  readonly adjacent?: boolean;
}) {
  if (adjacent) {
    return (
      <span
        className="fit-dot is-nearby"
        role="img"
        aria-label="Роль: рядом. Смежная роль вне семейств кампании"
        title="Роль: смежная (рядом)"
      >
        <WaveIcon />
      </span>
    );
  }
  if (roleMatch === 'target') {
    return (
      <span className="fit-dot is-yes" role="img" aria-label="Роль: совпадает" title="Роль: совпадает">
        <CheckIcon />
      </span>
    );
  }
  if (roleMatch === 'partial') {
    return (
      <span
        className="fit-dot is-nearby"
        role="img"
        aria-label="Роль: рядом. Функция совпадает, уровень рядом"
        title="Роль: рядом"
      >
        <WaveIcon />
      </span>
    );
  }
  return (
    <span className="fit-dot is-no" role="img" aria-label="Роль: не совпадает" title="Роль: не совпадает">
      <DashIcon />
    </span>
  );
}

export function LevelFitDot({
  levelMatch,
}: {
  readonly levelMatch: MatchedVacancyItem['explanation']['levelMatch'];
}) {
  if (levelMatch === 'match') {
    return (
      <span className="fit-dot is-yes" role="img" aria-label="Уровень: совпадает" title="Уровень: совпадает">
        <CheckIcon />
      </span>
    );
  }
  if (levelMatch === 'below' || levelMatch === 'above') {
    const desc =
      levelMatch === 'below'
        ? 'Вакансия ниже целевого уровня'
        : 'Вакансия выше целевого уровня';
    return (
      <span
        className="fit-dot is-nearby"
        role="img"
        aria-label={`Уровень: рядом. ${desc}`}
        title="Уровень: рядом"
      >
        <WaveIcon />
      </span>
    );
  }
  if (levelMatch === 'unknown') {
    return (
      <span className="fit-dot is-unknown" role="img" aria-label="Уровень не распознан" title="Уровень не распознан">
        ?
      </span>
    );
  }
  return (
    <span className="fit-dot is-no" role="img" aria-label="Уровень: не совпадает" title="Уровень: не совпадает">
      <DashIcon />
    </span>
  );
}

export function GeoFitDot({ outsideGeo }: { readonly outsideGeo?: boolean }) {
  if (!outsideGeo) {
    return (
      <span className="fit-dot is-yes" role="img" aria-label="География: совпадает" title="География: совпадает">
        <CheckIcon />
      </span>
    );
  }
  return (
    <span className="fit-dot is-no" role="img" aria-label="География: не совпадает" title="География: не совпадает">
      <DashIcon />
    </span>
  );
}
