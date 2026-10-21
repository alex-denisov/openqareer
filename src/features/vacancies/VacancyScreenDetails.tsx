import { useEffect } from 'react';
import {
  ArrowSquareOut,
  Briefcase,
  ChatCircleText,
  Check,
  CheckCircle,
  FileText,
  PaperPlaneTilt,
  Question,
  Target,
} from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import { extractVacancyRequirements } from './vacancyLevel';
import { fitRequirementChips, legacySkillChips } from './vacancyRequirementChips';
import { publishVacancyFitRead, useLatestVacancyFitView } from './vacancyFitViewUpdates';
import { readVacancyFit } from './vacancyFitApi';
import { useVacancySummary } from './vacancyDetailApi';
import { publishVacancyQuizOffer, unconfirmedSkills } from './vacancyQuizOffer';

interface VacancyScreenDetailRowProps {
  readonly onOpenArchive?: () => void;
  readonly onOpenResponses?: () => void;
  readonly onToggleCompanyWant?: () => void | Promise<void>;
  readonly companyWantKnown?: boolean;
  readonly isCompanyWanted?: boolean;
  readonly companyWantBusy?: boolean;
  readonly onDiscussWithConsultant?: (cluster: MatchedVacancyItem['cluster']) => void;
}

export interface CompanyPathToggle {
  readonly open: boolean;
  readonly panelId: string;
  readonly onToggle: () => void;
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
  path,
  cluster,
}: {
  readonly path?: CompanyPathToggle;
  readonly cluster: MatchedVacancyItem['cluster'];
}) {
  if (!path || !cluster.canonicalCompany) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary action-btn"
      aria-expanded={path.open}
      aria-controls={path.panelId}
      onClick={path.onToggle}
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
      className="btn btn-secondary action-btn is-accent"
      onClick={() => rowProps.onDiscussWithConsultant?.(cluster)}
    >
      <ChatCircleText size={15} aria-hidden="true" />
      Обсудить
    </button>
  );
}

/**
 * The list carries only the fit summary (compactFitView). An opened vacancy reads the full
 * analysis itself, so chips and the consultant offer work where no fit-evidence block is
 * rendered — the 390 push screen (B552).
 */
function useFitDetail(vacancyId: string, view: Parameters<typeof unconfirmedSkills>[0]) {
  const needsDetail = view?.state === 'ready' && view.requirements.length === 0;
  useEffect(() => {
    if (!needsDetail) return;
    const controller = new AbortController();
    void readVacancyFit(vacancyId, controller.signal)
      .then((next) => publishVacancyFitRead(vacancyId, next))
      .catch(() => undefined);
    return () => controller.abort();
  }, [vacancyId, needsDetail]);
}

/** The expanded vacancy tells the consultant panel what a quiz could confirm (B552). */
function usePublishQuizOffer(
  cluster: MatchedVacancyItem['cluster'],
  fitView: Parameters<typeof unconfirmedSkills>[0],
) {
  const skillsKey = unconfirmedSkills(fitView).join('\n');
  useEffect(() => {
    const skills = skillsKey ? skillsKey.split('\n') : [];
    publishVacancyQuizOffer(
      skills.length > 0
        ? { vacancyId: cluster.id, roleTitle: cluster.canonicalTitle, skills }
        : null,
    );
    return () => publishVacancyQuizOffer(null);
  }, [cluster.id, cluster.canonicalTitle, skillsKey]);
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
  const fitView = useLatestVacancyFitView(cluster.id, explanation.fitView);
  useFitDetail(cluster.id, fitView);
  const fromFit = fitRequirementChips(fitView);
  usePublishQuizOffer(cluster, fitView);
  const legacy = extractVacancyRequirements(
    explanation.matchingPoints,
    explanation.missingPoints,
    cluster.skills,
  );
  const chips = fromFit ?? legacySkillChips(legacy.skillMatching, legacy.skillMissing);
  const skillMatching = chips.confirmed;
  const skillMissing = chips.unconfirmed;
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
        <p className="vacancies-screen-no-requirements">Требования ещё не разобраны.</p>
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
          <CheckCircle size={14} aria-hidden="true" />
          <span className="career-sr-only">Подтверждено: </span>
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
  const icon = (
    <>
      <Question size={14} aria-hidden="true" />
      <span className="career-sr-only">Не проверено: </span>
    </>
  );
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
  path,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly rowProps: VacancyScreenDetailRowProps;
  readonly rowState: VacancyScreenActionState;
  readonly path?: CompanyPathToggle;
}) {
  return (
    <div className="action-row vacancies-detail-actions vacancies-screen-detail-actions">
      <ApplyAction cluster={cluster} rowProps={rowProps} rowState={rowState} />
      <PlatformAction cluster={cluster} />
      <CompanyPathAction path={path} cluster={cluster} />
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

export function VacancyScreenDescription({
  cluster,
  onOpenFull,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onOpenFull: () => void;
}) {
  const summary = useVacancySummary(cluster.id, cluster.descriptionSummary);
  return (
    <section
      className="vacancies-screen-description"
      aria-labelledby={`vacancy-description-${cluster.id}`}
    >
      <h3 id={`vacancy-description-${cluster.id}`}>Описание</h3>
      {summary.text ? (
        <p className="vacancies-screen-description-copy">{summary.text}</p>
      ) : summary.loading ? (
        <p className="vacancies-screen-description-empty" role="status">
          Загружаем описание…
        </p>
      ) : (
        <p className="vacancies-screen-description-empty">
          Краткое описание пока недоступно. Полный текст можно проверить на площадке.
        </p>
      )}
      <VacancyScreenFullDescriptionButton onOpen={onOpenFull} />
    </section>
  );
}
