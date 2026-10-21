import { VacancyFitInline } from './VacancyFitSummary';
import { CaretDown, CaretUp, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { formatCompensationCompact } from './vacancyCompensation';
import { vacancyAge } from './vacancyFilters';
import { vacancyTrustSignals } from '../../../shared/vacancyTrustSignals';
import { extractVacancyRequirements } from './vacancyLevel';
import { RoleFitDot, LevelFitDot, GeoFitDot } from './VacancyFitDots';
import { VacancyRowMeta } from './VacancyRowElements';

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

function VacancyReqTag({
  matching,
  total,
  missing,
}: {
  readonly matching: number;
  readonly total: number;
  readonly missing: number;
}) {
  if (total === 0) return null;
  if (matching > 0) {
    return (
      <span className="vac-req is-ok">
        <Check size={14} weight="bold" aria-hidden="true" />
        <span>
          Требования: <span className="num">{matching}</span> из{' '}
          <span className="num">{total}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="vac-req is-none">
      <Warning size={14} aria-hidden="true" />
      <span>
        Требования: не совпали (<span className="num">0</span> из{' '}
        <span className="num">{missing}</span>)
      </span>
    </span>
  );
}

function VacancyTrustTag({ trust }: { readonly trust: ReturnType<typeof vacancyTrustSignals> }) {
  if (trust.level === 'ok' || trust.reasons.length === 0) return null;
  return (
    <span
      className={`vac-trust is-${trust.level} vac-trust-line`}
      role="status"
      data-trust-level={trust.level}
    >
      <Warning size={14} aria-hidden="true" />
      <span>{trust.reasons[0]}</span>
    </span>
  );
}

function VacancyRowTitleCol({
  cluster,
  skillMatching,
  skillMissing,
  trust,
  showRequirements = true,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly skillMatching: readonly string[];
  readonly skillMissing: readonly string[];
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
  readonly showRequirements?: boolean;
}) {
  const total = skillMatching.length + skillMissing.length;
  return (
    <span className="vac-title-col">
      <span className="vac-title">{cluster.canonicalTitle}</span>
      <span className="vac-sub">{vacancySubtitle(cluster)}</span>
      {showRequirements ? (
        <VacancyReqTag
          matching={skillMatching.length}
          total={total}
          missing={skillMissing.length}
        />
      ) : null}
      <VacancyTrustTag trust={trust} />
    </span>
  );
}

export function VacancyRowChevron({ isSelected }: { readonly isSelected: boolean }) {
  const Icon = isSelected ? CaretUp : CaretDown;
  return <Icon className="vac-chevron" size={16} aria-hidden="true" />;
}

export function VacancyDefaultSummaryContent({
  cluster,
  explanation,
  trust,
  age,
  alreadyApplied,
  applicationArchived,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
  readonly age: ReturnType<typeof vacancyAge>;
  readonly alreadyApplied: boolean;
  readonly applicationArchived: boolean;
}) {
  const { skillMatching, skillMissing } = extractVacancyRequirements(
    explanation.matchingPoints,
    explanation.missingPoints,
    cluster.skills,
  );
  return (
    <>
      <span className="vac-logo" aria-hidden="true">
        {logoInitials(cluster.canonicalCompany)}
      </span>
      <span className="vac-main">
        <VacancyRowTitleCol
          cluster={cluster}
          showRequirements={!explanation.fitView}
          skillMatching={skillMatching}
          skillMissing={skillMissing}
          trust={trust}
        />
        <VacancyFitInline vacancyId={cluster.id} view={explanation.fitView} />
        <VacancyRowMeta
          comp={formatCompensationCompact(cluster.salary)}
          age={age}
          alreadyApplied={alreadyApplied}
          applicationArchived={applicationArchived}
        />
        <span className="vac-fit">
          <RoleFitDot roleMatch={explanation.roleMatch} adjacent={explanation.adjacentRole} />
          <LevelFitDot levelMatch={explanation.levelMatch} />
          <GeoFitDot outsideGeo={explanation.outsideGeography} />
        </span>
      </span>
    </>
  );
}
