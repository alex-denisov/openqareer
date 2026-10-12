import {
  ArrowSquareOut,
  Briefcase,
  ChatCircleText,
  Check,
  FileText,
  PaperPlaneTilt,
  Target,
  Warning,
} from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { extractVacancyRequirements } from './vacancyLevel';

interface VacancyScreenDetailRowProps {
  readonly onOpenArchive?: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenCompanyPath?: () => void;
  readonly companyContactsCount?: number | null;
  readonly onToggleCompanyWant?: () => void | Promise<void>;
  readonly companyWantKnown?: boolean;
  readonly isCompanyWanted?: boolean;
  readonly companyWantBusy?: boolean;
  readonly onDiscussWithConsultant?: (cluster: MatchedVacancyItem['cluster']) => void;
}

interface VacancyScreenActionState {
  readonly applicationArchived: boolean;
  readonly alreadyApplied: boolean;
  readonly externalOpened: boolean;
  readonly handleConfirmSent: () => void | Promise<void>;
  readonly savingApplied?: boolean;
  readonly handleApplyExternal: () => void;
}

function ApplyAction({
  cluster,
  rowProps,
  rowState,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly rowState: VacancyScreenActionState;
}) {
  if (rowState.applicationArchived) return <ArchivedApplicationAction rowProps={rowProps} />;
  if (rowState.alreadyApplied) return <RecordedApplicationAction rowProps={rowProps} />;
  if (rowState.externalOpened) return <ConfirmSentAction rowState={rowState} />;
  return (
    <button
      type="button"
      className="btn btn-primary action-btn"
      onClick={rowState.handleApplyExternal}
      disabled={!cluster.primaryUrl}
    >
      <PaperPlaneTilt size={15} aria-hidden="true" />
      Откликнуться
    </button>
  );
}

function ArchivedApplicationAction({
  rowProps,
}: {
  readonly rowProps: VacancyScreenDetailRowProps;
}) {
  return rowProps.onOpenArchive ? (
    <button type="button" className="btn btn-secondary action-btn" onClick={rowProps.onOpenArchive}>
      Открыть архив
    </button>
  ) : (
    <span className="applied-note is-archived">Отклик в архиве</span>
  );
}

function RecordedApplicationAction({
  rowProps,
}: {
  readonly rowProps: VacancyScreenDetailRowProps;
}) {
  return rowProps.onOpenResponses ? (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      onClick={rowProps.onOpenResponses}
    >
      Перейти в «Отклики»
    </button>
  ) : (
    <span className="applied-note">
      <Check size={14} weight="bold" aria-hidden="true" />
      Отклик отмечен
    </span>
  );
}

function ConfirmSentAction({ rowState }: { readonly rowState: VacancyScreenActionState }) {
  return (
    <button
      type="button"
      className="btn btn-primary action-btn"
      onClick={() => void rowState.handleConfirmSent()}
      disabled={rowState.savingApplied}
    >
      <Check size={15} aria-hidden="true" />
      Да, отклик отправлен
    </button>
  );
}

function PlatformAction({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      onClick={() => void openExternalLink(cluster.primaryUrl)}
      disabled={!cluster.primaryUrl}
    >
      <ArrowSquareOut size={15} aria-hidden="true" />
      На площадке
    </button>
  );
}

function CompanyPathAction({
  rowProps,
  cluster,
}: {
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly cluster: MatchedVacancyItem['cluster'];
}) {
  if (!rowProps.onOpenCompanyPath) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      onClick={rowProps.onOpenCompanyPath}
      disabled={!cluster.canonicalCompany}
    >
      <Briefcase size={15} aria-hidden="true" />
      Путь к компании
    </button>
  );
}

function WantCompanyAction({
  rowProps,
  cluster,
}: {
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly cluster: MatchedVacancyItem['cluster'];
}) {
  if (!rowProps.onToggleCompanyWant || !cluster.canonicalCompany) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      aria-pressed={rowProps.companyWantKnown ? Boolean(rowProps.isCompanyWanted) : undefined}
      aria-busy={Boolean(rowProps.companyWantBusy)}
      disabled={rowProps.companyWantBusy}
      onClick={() => void rowProps.onToggleCompanyWant?.()}
    >
      <Target size={15} weight={rowProps.isCompanyWanted ? 'fill' : 'regular'} aria-hidden="true" />
      {rowProps.isCompanyWanted ? 'Убрать из «Хочу»' : 'Хочу в эту компанию'}
    </button>
  );
}

function DiscussAction({
  rowProps,
  cluster,
}: {
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly cluster: MatchedVacancyItem['cluster'];
}) {
  if (!rowProps.onDiscussWithConsultant) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      onClick={() => rowProps.onDiscussWithConsultant?.(cluster)}
    >
      <ChatCircleText size={15} aria-hidden="true" />
      Обсудить
    </button>
  );
}

export function VacancyScreenRequirementChips({
  cluster,
  explanation,
  onAddToProfile,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  const { skillMatching, skillMissing } = extractVacancyRequirements(
    explanation.matchingPoints,
    explanation.missingPoints,
    cluster.skills,
  );
  const hasRequirements = skillMatching.length + skillMissing.length > 0;

  return (
    <section
      className="vacancies-screen-requirements"
      aria-labelledby={`vacancy-requirements-${cluster.id}`}
    >
      <h3 id={`vacancy-requirements-${cluster.id}`}>Требования к навыкам</h3>
      {hasRequirements ? (
        <VacancySkillChips
          matching={skillMatching}
          missing={skillMissing}
          cluster={cluster}
          onAddToProfile={onAddToProfile}
        />
      ) : (
        <p className="vacancies-screen-no-requirements">
          В источниках не указаны требования к навыкам.
        </p>
      )}
      <p className="vacancies-screen-requirements-note">
        Из описания вакансии и тегов источника. «Подтверждено» — навык проверен квизом или проверкой
        навыков.
      </p>
    </section>
  );
}

function VacancySkillChips({
  matching,
  missing,
  cluster,
  onAddToProfile,
}: {
  readonly matching: readonly string[];
  readonly missing: readonly string[];
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  return (
    <ul className="vacancies-screen-skill-chips">
      {matching.map((skill) => (
        <li className="vacancies-screen-skill-chip is-confirmed" key={`confirmed-${skill}`}>
          <Check size={14} weight="bold" aria-hidden="true" />
          <span>{skill}</span>
        </li>
      ))}
      {missing.map((skill) => (
        <MissingVacancySkillChip
          key={`unconfirmed-${skill}`}
          skill={skill}
          cluster={cluster}
          onAddToProfile={onAddToProfile}
        />
      ))}
    </ul>
  );
}

function MissingVacancySkillChip({
  skill,
  cluster,
  onAddToProfile,
}: {
  readonly skill: string;
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  const icon = <Warning size={14} aria-hidden="true" />;
  const label = <span>{skill}</span>;
  return (
    <li className="vacancies-screen-skill-chip is-unconfirmed">
      {onAddToProfile ? (
        <button
          type="button"
          aria-label={`Добавить «${skill}» в профиль`}
          title={`Добавить «${skill}» в профиль`}
          onClick={() =>
            onAddToProfile({
              requirement: skill,
              vacancyId: cluster.id,
              vacancyTitle: cluster.canonicalTitle,
              vacancyCompany: cluster.canonicalCompany,
            })
          }
        >
          {icon}
          {label}
        </button>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </li>
  );
}

export function VacancyScreenDetailActions({
  cluster,
  rowProps,
  rowState,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly rowState: VacancyScreenActionState;
}) {
  return (
    <div className="action-row vacancies-detail-actions vacancies-screen-detail-actions">
      <ApplyAction cluster={cluster} rowProps={rowProps} rowState={rowState} />
      <PlatformAction cluster={cluster} />
      <CompanyPathAction rowProps={rowProps} cluster={cluster} />
      <WantCompanyAction rowProps={rowProps} cluster={cluster} />
      <DiscussAction rowProps={rowProps} cluster={cluster} />
    </div>
  );
}

export function VacancyScreenFullDescriptionButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn vacancies-screen-full-description"
      onClick={onOpen}
    >
      <FileText size={15} aria-hidden="true" />
      Полное описание
    </button>
  );
}
