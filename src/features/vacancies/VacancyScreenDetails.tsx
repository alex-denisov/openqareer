import { useEffect } from 'react';
import { vacancyFitPercent } from '../../../shared/vacancyFitPercent';
import {
  ArrowSquareOut,
  Briefcase,
  ChatCircleText,
  Check,
  CheckCircle,
  Circle,
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
import { vacancyFitMark } from './vacancyFitModel';

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
/** True while the ready fit's requirements are still being read. */
function useFitDetail(vacancyId: string, view: Parameters<typeof unconfirmedSkills>[0]): boolean {
  const needsDetail =
    (view?.state === 'ready' || view?.state === 'refreshing') && view.requirements.length === 0;
  useEffect(() => {
    if (!needsDetail) return;
    const controller = new AbortController();
    void readVacancyFit(vacancyId, controller.signal)
      .then((next) => publishVacancyFitRead(vacancyId, next))
      .catch(() => undefined);
    return () => controller.abort();
  }, [vacancyId, needsDetail]);
  useCountingFitPoll(vacancyId, view);
  return needsDetail;
}

/** How often an opened vacancy re-reads a percent that is still counting. */
const FIT_COUNTING_POLL_MS = 15_000;

/**
 * 28.10 mockup: the block says «считаем» and the worker answers within a minute, so the opened
 * vacancy reads its percent again on its own (moved here with the old «Соответствие» block, 29.10).
 */
function useCountingFitPoll(vacancyId: string, view: Parameters<typeof unconfirmedSkills>[0]) {
  const counting = vacancyFitMark(view).kind === 'pending';
  useEffect(() => {
    if (!counting) return undefined;
    const timer = window.setInterval(() => {
      void readVacancyFit(vacancyId)
        .then((next) => publishVacancyFitRead(vacancyId, next))
        .catch(() => undefined);
    }, FIT_COUNTING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [vacancyId, counting]);
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

/** Requirements are parsed but none has a short name yet: the model labels arrive soon (B510). */
const REQUIREMENTS_PENDING_TEXT = 'Требования разбираются — появятся в течение часа';

/** «Условия: Высшее образование, английский B2 · подтверждено 1 из 2» (G5 item 9), inside the
 *  source caption so the card keeps the mockup's chips + one caption (B525 V4). */
function RequirementConditions({
  chips: { conditions },
  coverage,
}: {
  readonly chips: { readonly conditions?: readonly string[] };
  readonly coverage?: { readonly matched: number; readonly total: number };
}) {
  if (!conditions?.length) return null;
  const confirmed = coverage?.total
    ? ` · подтверждено ${coverage.matched} из ${coverage.total}`
    : '';
  return (
    <>
      <span className="vacancies-screen-requirements-conditions">
        Условия: {conditions.join(', ')}
        {confirmed}
      </span>{' '}
    </>
  );
}

function requirementsStatusText(reading: boolean, fromFit: boolean): string {
  if (reading) return 'Загружаем требования…';
  return fromFit ? REQUIREMENTS_PENDING_TEXT : 'Требования ещё не разобраны.';
}

// G5 W2: while the fit's requirements load, legacy matcher points (sentences such as «Функция
// роли и уровень совпадают…») must not flash as chips.
const NO_CHIPS: ReturnType<typeof legacySkillChips> = { confirmed: [], unconfirmed: [] };
const legacyChips = (legacy: ReturnType<typeof extractVacancyRequirements>) =>
  legacySkillChips(legacy.skillMatching, legacy.skillMissing);

function RequirementsHeading({
  id,
  counted,
}: {
  readonly id: string;
  readonly counted: number | null;
}) {
  return (
    <h3 id={id}>
      Требования к навыкам
      {counted === null ? null : (
        <>
          {' · '}
          <span className="num">{counted}</span>
        </>
      )}
    </h3>
  );
}

function chipCount(chips: ReturnType<typeof legacySkillChips>): number {
  return chips.confirmed.length + chips.unconfirmed.length + (chips.stated?.length ?? 0);
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
  const readingRequirements = useFitDetail(cluster.id, fitView);
  const fromFit = fitRequirementChips(fitView);
  usePublishQuizOffer(cluster, fitView);
  const legacy = extractVacancyRequirements(
    explanation.matchingPoints,
    explanation.missingPoints,
    cluster.skills,
  );
  const chips = fromFit ?? (readingRequirements ? NO_CHIPS : legacyChips(legacy));
  const hasRequirements = chipCount(chips) > 0;
  // 28.10 mockup: with a percent the card lists every requirement it counted, under one count.
  const counted = vacancyFitPercent(fitView) === null ? null : fitView!.result!.coverage.total;
  return (
    <section
      className="vacancies-screen-requirements"
      aria-labelledby={`vacancy-requirements-${cluster.id}`}
    >
      <RequirementsHeading id={`vacancy-requirements-${cluster.id}`} counted={counted} />
      {hasRequirements ? (
        <VacancySkillChips
          matching={chips.confirmed}
          missing={chips.unconfirmed}
          stated={chips.stated}
          quotes={chips.quotes}
          cluster={cluster}
          onAddToProfile={onAddToProfile}
        />
      ) : (
        <p className="vacancies-screen-no-requirements">
          {requirementsStatusText(readingRequirements, Boolean(fromFit))}
        </p>
      )}
      <p className="vacancies-screen-requirements-note">
        <RequirementConditions chips={chips} coverage={fitView?.result?.conditionCoverage} />
        {counted === null
          ? 'Из описания вакансии и тегов источника. Зелёные подтверждаются профилем.'
          : FIT_CHIPS_CAPTION}
      </p>
    </section>
  );
}

/** The caption under the full list of counted requirements (28.10 mockup, server data model). */
export const FIT_CHIPS_CAPTION =
  'Все требования из текста вакансии, по ним посчитан процент. Зелёные подтверждены проверкой навыков, жёлтые указаны в профиле без проверки.';

/**
 * Every counted requirement, never «Ещё N» (owner 29.10): yellow — stated in the profile without
 * a check, outline — missing, green — confirmed by a skill check.
 */
function VacancySkillChips({
  matching,
  missing,
  stated = [],
  quotes,
  cluster,
  onAddToProfile,
}: {
  readonly matching: readonly string[];
  readonly missing: readonly string[];
  readonly stated?: readonly string[];
  readonly quotes?: Readonly<Record<string, string>>;
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  return (
    <ul className="vacancies-screen-skill-chips">
      {stated.map((skill) => (
        <li className="vacancies-screen-skill-chip is-stated" key={`stated-${skill}`}>
          <Question size={14} aria-hidden="true" />
          <span className="career-sr-only">Указано в профиле, не проверено: </span>
          <span title={quotes?.[skill]}>{skill}</span>
        </li>
      ))}
      {missing.map((skill) => (
        <MissingVacancySkillChip
          key={`unconfirmed-${skill}`}
          skill={skill}
          quote={quotes?.[skill]}
          cluster={cluster}
          onAddToProfile={onAddToProfile}
        />
      ))}
      {matching.map((skill) => (
        <li className="vacancies-screen-skill-chip is-confirmed" key={`confirmed-${skill}`}>
          <CheckCircle size={14} aria-hidden="true" />
          <span className="career-sr-only">Подтверждено проверкой: </span>
          <span title={quotes?.[skill]}>{skill}</span>
        </li>
      ))}
    </ul>
  );
}

function MissingVacancySkillChip({
  skill,
  quote,
  cluster,
  onAddToProfile,
}: {
  readonly skill: string;
  readonly quote?: string;
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  const icon = (
    <>
      <Circle size={14} aria-hidden="true" />
      <span className="career-sr-only">Нет в профиле: </span>
    </>
  );
  const label = <span title={quote}>{skill}</span>;
  return (
    <li className="vacancies-screen-skill-chip is-missing">
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
    <button type="button" className="vac-sm vacancies-screen-full-description" onClick={onOpen}>
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
          Краткого описания нет. Полный текст можно проверить на площадке.
        </p>
      )}
      <VacancyScreenFullDescriptionButton onOpen={onOpenFull} />
    </section>
  );
}
