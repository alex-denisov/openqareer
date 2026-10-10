import { useState, type FormEvent } from 'react';
import { Archive, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyAge } from './vacancyFilters';
import { vacancyTrustSignals } from '../../../shared/vacancyTrustSignals';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
import { recruiterEnrichPayload } from './recruiterEnrichPayload';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { VacancyInfoModal } from './VacancyInfoModal';
import { VacancyPitchModal } from './VacancyPitchModal';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { VacancyScreenRowCells } from './VacancyScreenRowCells';
import {
  VacancyDefaultSummaryContent as DefaultVacancySummaryContent,
  VacancyRowChevron as ScreenVacancyRowChevron,
} from './VacancyRowSummaryElements';
import type { VacancyApplications } from './useVacancyApplications';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import type { ApplicationView } from '../applications/applicationsApi';
import { extractVacancyRequirements, LEVEL_HUMAN_NAMES } from './vacancyLevel';
import { VacancyInterviewForm } from './VacancyInterviewForm';
import {
  CompanyPathButton,
  NotAppliedActions,
  VacancyCollectionActions,
  VacancyMoreActions,
  vacancySnapshot,
} from './VacancyRowElements';

export interface VacancyRowProps {
  readonly layout?: 'default' | 'screen';
  readonly item: MatchedVacancyItem;
  readonly now: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly applications?: VacancyApplications;
  readonly archivedApplicationClusterIds?: ReadonlySet<string>;
  readonly onMarkAlreadyApplied?: (
    clusterId: string,
    vacancy: VacancyApplicationSnapshot,
  ) => Promise<void>;
  readonly onScheduleInterview?: (
    clusterId: string,
    scheduledAt: string,
    vacancy: VacancyApplicationSnapshot,
  ) => Promise<ApplicationView>;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenArchive?: () => void;
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
  readonly onDiscussWithConsultant?: (cluster: MatchedVacancyItem['cluster']) => void;
  readonly isSaved?: boolean;
  readonly saveBusy?: boolean;
  readonly onToggleSaved?: () => void | Promise<void>;
  readonly isCompanyWanted?: boolean;
  readonly companyWantKnown?: boolean;
  readonly companyWantBusy?: boolean;
  readonly companyContactsCount?: number | null;
  readonly onToggleCompanyWant?: () => void | Promise<void>;
  readonly onOpenCompanyPath?: () => void;
}

interface SummaryProps {
  readonly layout?: 'default' | 'screen';
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly isSelected: boolean;
  readonly alreadyApplied: boolean;
  readonly applicationArchived: boolean;
  readonly age: ReturnType<typeof vacancyAge>;
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
  readonly onSelect: () => void;
}

function VacancyRowSummary({
  layout = 'default',
  cluster,
  explanation,
  isSelected,
  alreadyApplied,
  applicationArchived,
  age,
  trust,
  onSelect,
}: SummaryProps) {
  return (
    <button
      type="button"
      className={`vac-row${layout === 'screen' ? ' vacancies-screen-row' : ''}${isSelected ? ' is-selected' : ''}${alreadyApplied && !applicationArchived ? ' is-applied' : ''}${applicationArchived ? ' is-archived' : ''}`}
      aria-pressed={isSelected}
      aria-expanded={isSelected}
      onClick={onSelect}
    >
      {layout === 'screen' ? (
        <VacancyScreenRowCells
          item={{ cluster, explanation }}
          applicationArchived={applicationArchived}
          alreadyApplied={alreadyApplied}
        />
      ) : (
        <DefaultVacancySummaryContent
          cluster={cluster}
          explanation={explanation}
          trust={trust}
          age={age}
          alreadyApplied={alreadyApplied}
          applicationArchived={applicationArchived}
        />
      )}
      <ScreenVacancyRowChevron isSelected={isSelected} />
    </button>
  );
}


function MissingPointItem({
  point,
  cluster,
  onAddToProfile,
}: {
  readonly point: string;
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  return (
    <li className="req-no">
      <Warning size={14} aria-hidden="true" />
      <span>{point}</span>
      {onAddToProfile ? (
        <button
          type="button"
          className="level-note"
          onClick={() =>
            onAddToProfile({
              requirement: point,
              vacancyId: cluster.id,
              vacancyTitle: cluster.canonicalTitle,
              vacancyCompany: cluster.canonicalCompany,
            })
          }
        >
          Добавить в профиль
        </button>
      ) : null}
    </li>
  );
}

function VacancyDetailGrid({
  cluster,
  matchingPoints,
  missingPoints,
  onAddToProfile,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly matchingPoints: readonly string[];
  readonly missingPoints: readonly string[];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  return (
    <div className="vac-detail-grid">
      <div className="req-block">
        <h5>Совпадает по фактам профиля</h5>
        {matchingPoints.length > 0 ? (
          <ul className="req-list">
            {matchingPoints.map((point) => (
              <li key={point} className="req-yes">
                <Check size={14} weight="bold" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vac-sub">Нет подтверждённых пунктов</p>
        )}
      </div>

      <div className="req-block">
        <h5>Не подтверждено — спросят на интервью</h5>
        {missingPoints.length > 0 ? (
          <ul className="req-list">
            {missingPoints.map((point) => (
              <MissingPointItem
                key={point}
                point={point}
                cluster={cluster}
                onAddToProfile={onAddToProfile}
              />
            ))}
          </ul>
        ) : (
          <p className="vac-sub">Все ключевые требования подтверждены</p>
        )}
      </div>
    </div>
  );
}

interface ActionButtonsProps {
  readonly alreadyApplied: boolean;
  readonly applicationArchived: boolean;
  readonly savingApplied: boolean;
  readonly onOpenResponses?: () => void;
  readonly onOpenArchive?: () => void;
  readonly onToggleSchedule?: () => void;
  readonly externalOpened: boolean;
  readonly onApplyExternal: () => void;
  readonly onConfirmSent: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
  readonly onOpenNetworking?: () => void;
  readonly onDiscussWithConsultant?: () => void;
  readonly onOpenInfo: () => void;
  readonly onOpenPitch: () => void;
}

function AppliedActions({
  applicationArchived,
  onOpenResponses,
  onOpenArchive,
  onToggleSchedule,
}: {
  readonly applicationArchived: boolean;
  readonly onOpenResponses?: () => void;
  readonly onOpenArchive?: () => void;
  readonly onToggleSchedule?: () => void;
}) {
  if (applicationArchived) {
    return (
      <>
        <span className="applied-note is-archived">
          <Archive size={14} aria-hidden="true" />
          Отклик в архиве
        </span>
        {onOpenArchive ? (
          <button type="button" className="btn btn-secondary action-btn" onClick={onOpenArchive}>
            Открыть архив
          </button>
        ) : null}
      </>
    );
  }
  return (
    <>
      <span className="applied-note">
        <Check size={14} weight="bold" aria-hidden="true" />
        Отклик отмечен
      </span>
      {onOpenResponses ? (
        <button type="button" className="btn btn-secondary action-btn" onClick={onOpenResponses}>
          Перейти в «Отклики»
        </button>
      ) : null}
      {onToggleSchedule ? (
        <button type="button" className="btn btn-secondary action-btn" onClick={onToggleSchedule}>
          Назначили интервью
        </button>
      ) : null}
    </>
  );
}

function VacancyActionButtons({
  alreadyApplied,
  applicationArchived,
  savingApplied,
  onOpenResponses,
  onOpenArchive,
  onToggleSchedule,
  externalOpened,
  onApplyExternal,
  onConfirmSent,
  onConfirmAlreadyApplied,
  onOpenNetworking,
  onDiscussWithConsultant,
  onOpenInfo,
  onOpenPitch,
}: ActionButtonsProps) {
  return (
    <div className="action-row vacancies-detail-actions">
      <VacancyStatusActions
        alreadyApplied={alreadyApplied}
        applicationArchived={applicationArchived}
        savingApplied={savingApplied}
        onOpenResponses={onOpenResponses}
        onOpenArchive={onOpenArchive}
        onToggleSchedule={onToggleSchedule}
        externalOpened={externalOpened}
        onApplyExternal={onApplyExternal}
        onConfirmSent={onConfirmSent}
        onConfirmAlreadyApplied={onConfirmAlreadyApplied}
      />

      <VacancyMoreActions
        onDiscussWithConsultant={onDiscussWithConsultant}
        onOpenNetworking={onOpenNetworking}
      />

      <button type="button" className="btn btn-secondary action-btn" onClick={onOpenInfo}>
        Подробнее
      </button>

      <button type="button" className="btn btn-secondary action-btn" onClick={onOpenPitch}>
        Сопроводительное письмо
      </button>
    </div>
  );
}

function VacancyStatusActions(
  props: Pick<
    ActionButtonsProps,
    | 'alreadyApplied'
    | 'applicationArchived'
    | 'savingApplied'
    | 'onOpenResponses'
    | 'onOpenArchive'
    | 'onToggleSchedule'
    | 'externalOpened'
    | 'onApplyExternal'
    | 'onConfirmSent'
    | 'onConfirmAlreadyApplied'
  >,
) {
  if (props.alreadyApplied) {
    return (
      <AppliedActions
        applicationArchived={props.applicationArchived}
        onOpenResponses={props.onOpenResponses}
        onOpenArchive={props.onOpenArchive}
        onToggleSchedule={props.onToggleSchedule}
      />
    );
  }
  return (
    <NotAppliedActions
      savingApplied={props.savingApplied}
      externalOpened={props.externalOpened}
      onApplyExternal={props.onApplyExternal}
      onConfirmSent={props.onConfirmSent}
      onConfirmAlreadyApplied={props.onConfirmAlreadyApplied}
    />
  );
}

function useVacancyRowInterview(
  cluster: MatchedVacancyItem['cluster'],
  onScheduleInterview?: VacancyRowProps['onScheduleInterview'],
) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string>();
  const [prepApplication, setPrepApplication] = useState<ApplicationView>();

  const handleScheduleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!scheduledLocal || !onScheduleInterview) return;
    const date = new Date(scheduledLocal);
    if (Number.isNaN(date.getTime())) {
      setScheduleError('Проверьте дату и время интервью.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError(undefined);
    try {
      const res = await onScheduleInterview(
        cluster.id,
        date.toISOString(),
        vacancySnapshot(cluster),
      );
      setScheduleOpen(false);
      setPrepApplication(res);
    } catch {
      setScheduleError('Не удалось назначить интервью. Этап не изменён.');
    } finally {
      setSavingSchedule(false);
    }
  };

  return {
    scheduleOpen,
    setScheduleOpen,
    scheduledLocal,
    setScheduledLocal,
    savingSchedule,
    scheduleError,
    prepApplication,
    setPrepApplication,
    handleScheduleSubmit,
  };
}

function useVacancyRowApplied(
  cluster: MatchedVacancyItem['cluster'],
  onMarkAlreadyApplied?: VacancyRowProps['onMarkAlreadyApplied'],
) {
  const [savingApplied, setSavingApplied] = useState(false);
  const [appliedError, setAppliedError] = useState<string>();

  const handleConfirmAlreadyApplied = async () => {
    if (!onMarkAlreadyApplied) return;
    setSavingApplied(true);
    setAppliedError(undefined);
    try {
      await onMarkAlreadyApplied(cluster.id, vacancySnapshot(cluster));
    } catch {
      setAppliedError('Не удалось сохранить отклик. Состояние не изменено.');
    } finally {
      setSavingApplied(false);
    }
  };

  return {
    savingApplied,
    appliedError,
    handleConfirmAlreadyApplied,
  };
}

function useVacancyRowState({
  item,
  now,
  applications,
  archivedApplicationClusterIds,
  onMarkAlreadyApplied,
  onScheduleInterview,
}: VacancyRowProps) {
  const { cluster } = item;
  const [infoOpen, setInfoOpen] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);
  const interviewState = useVacancyRowInterview(cluster, onScheduleInterview);
  const appliedState = useVacancyRowApplied(cluster, onMarkAlreadyApplied);
  const application = applications?.byCluster.get(cluster.id);
  const applicationArchived = archivedApplicationClusterIds?.has(cluster.id) ?? false;

  // B341: открытие сайта ещё не отклик — отмечаем только по подтверждению.
  const [externalOpened, setExternalOpened] = useState(false);
  const handleApplyExternal = () => {
    void openExternalLink(cluster.primaryUrl);
    setExternalOpened(true);
  };
  const handleConfirmSent = () => {
    applications?.record(cluster.id, 'applied', vacancySnapshot(cluster));
  };

  return {
    age: vacancyAge(cluster, now),
    trust: vacancyTrustSignals(cluster, now),
    alreadyApplied: applicationArchived || application?.status === 'applied',
    applicationArchived,
    infoOpen,
    setInfoOpen,
    pitchOpen,
    setPitchOpen,
    interviewState,
    appliedState,
    handleApplyExternal,
    externalOpened,
    handleConfirmSent,
  };
}

function RecruiterSection({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <div className="recruiter-row vacancies-recruiter-block">
      <strong>Кто нанимает:</strong>{' '}
      <RecruiterContactsBlock
        vacancyId={cluster.id}
        vacancyPayload={recruiterEnrichPayload(cluster)}
      />
    </div>
  );
}

function DetailTrustAlert({ trust }: { readonly trust: ReturnType<typeof vacancyTrustSignals> }) {
  if (trust.level === 'ok' || trust.reasons.length === 0) return null;
  return (
    <div
      className={`vacancies-detail-trust-alert is-${trust.level}`}
      role="status"
      data-trust-level={trust.level}
    >
      <Warning size={16} aria-hidden="true" />
      <span>{trust.reasons.join(' · ')}</span>
    </div>
  );
}

interface DetailProps {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly rowProps: VacancyRowProps;
  readonly rowState: ReturnType<typeof useVacancyRowState>;
}

function DetailInterviewSection({
  appliedError,
  interviewState,
}: {
  readonly appliedError?: string;
  readonly interviewState: ReturnType<typeof useVacancyRowInterview>;
}) {
  return (
    <>
      {appliedError ? (
        <p className="vacancies-interview-error" role="alert">
          {appliedError}
        </p>
      ) : null}

      {interviewState.scheduleOpen ? (
        <VacancyInterviewForm
          scheduledLocal={interviewState.scheduledLocal}
          savingSchedule={interviewState.savingSchedule}
          scheduleError={interviewState.scheduleError}
          onChangeDate={interviewState.setScheduledLocal}
          onClose={() => interviewState.setScheduleOpen(false)}
          onSubmit={(e) => void interviewState.handleScheduleSubmit(e)}
        />
      ) : null}
    </>
  );
}

function externalApplyProps(rowState: {
  readonly externalOpened: boolean;
  readonly handleApplyExternal: () => void;
  readonly handleConfirmSent: () => void;
}) {
  return {
    externalOpened: rowState.externalOpened,
    onApplyExternal: rowState.handleApplyExternal,
    onConfirmSent: rowState.handleConfirmSent,
  };
}

function DetailRequirementsSection({
  cluster,
  explanation,
  onAddToProfile,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly onAddToProfile?: VacancyRowProps['onAddToProfile'];
}) {
  const { skillMatching, skillMissing, vacancyLevel } = extractVacancyRequirements(
    explanation.matchingPoints,
    explanation.missingPoints,
    cluster.skills,
  );
  const total = skillMatching.length + skillMissing.length;
  return (
    <>
      {vacancyLevel ? (
        <p className="vac-level-row">
          Уровень вакансии: <strong>{LEVEL_HUMAN_NAMES[vacancyLevel]}</strong>
        </p>
      ) : null}
      <p className="req-summary">
        {total > 0
          ? `Требования вакансии: ${skillMatching.length} из ${total} подтверждены фактами профиля`
          : 'Требования вакансии не указаны в явном виде'}
      </p>
      <VacancyDetailGrid
        cluster={cluster}
        matchingPoints={skillMatching}
        missingPoints={skillMissing}
        onAddToProfile={onAddToProfile}
      />
    </>
  );
}

function buildActionButtonsProps(
  rowProps: DetailProps['rowProps'],
  rowState: DetailProps['rowState'],
  cluster: DetailProps['cluster'],
) {
  const { interviewState, appliedState } = rowState;
  return {
    alreadyApplied: rowState.alreadyApplied,
    applicationArchived: rowState.applicationArchived,
    savingApplied: appliedState.savingApplied,
    onOpenResponses: rowProps.onOpenResponses,
    onOpenArchive: rowProps.onOpenArchive,
    onToggleSchedule: rowProps.onScheduleInterview
      ? () => interviewState.setScheduleOpen((prev) => !prev)
      : undefined,
    ...externalApplyProps(rowState),
    onConfirmAlreadyApplied: rowProps.onMarkAlreadyApplied
      ? () => void appliedState.handleConfirmAlreadyApplied()
      : undefined,
    onOpenNetworking: rowProps.onOpenNetworking
      ? () => rowProps.onOpenNetworking!(cluster)
      : undefined,
    onDiscussWithConsultant: rowProps.onDiscussWithConsultant
      ? () => rowProps.onDiscussWithConsultant!(cluster)
      : undefined,
    onOpenInfo: () => rowState.setInfoOpen(true),
    onOpenPitch: () => rowState.setPitchOpen(true),
  };
}

function VacancyRowDetail({ cluster, explanation, rowProps, rowState }: DetailProps) {
  const { interviewState, appliedState, trust } = rowState;
  const source = vacancySourceLabels(cluster.sources)[0];

  return (
    <div className="vac-detail vacancies-detail-col vacancies-detail-panel">
      <DetailTrustAlert trust={trust} />
      {source ? <p className="vac-sub vac-source">Опубликована на {source}</p> : null}
      <DetailRequirementsSection
        cluster={cluster}
        explanation={explanation}
        onAddToProfile={rowProps.onAddToProfile}
      />

      <RecruiterSection cluster={cluster} />
      {rowProps.onOpenCompanyPath ? (
        <CompanyPathButton
          count={rowProps.companyContactsCount}
          onOpen={rowProps.onOpenCompanyPath}
        />
      ) : null}
      <VacancyActionButtons {...buildActionButtonsProps(rowProps, rowState, cluster)} />

      <DetailInterviewSection
        appliedError={appliedState.appliedError}
        interviewState={interviewState}
      />
    </div>
  );
}

function VacancyRowModals({
  cluster,
  rowState,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly rowState: ReturnType<typeof useVacancyRowState>;
}) {
  return (
    <>
      <VacancyInfoModal
        isOpen={rowState.infoOpen}
        onClose={() => rowState.setInfoOpen(false)}
        cluster={cluster}
      />
      {rowState.pitchOpen ? (
        <VacancyPitchModal
          isOpen
          onClose={() => rowState.setPitchOpen(false)}
          vacancy={{
            id: cluster.id,
            title: cluster.canonicalTitle,
            company: cluster.canonicalCompany,
            location: cluster.canonicalLocation,
            isRemote: cluster.isRemote,
            skills: cluster.skills,
            descriptionSummary: cluster.descriptionSummary,
          }}
        />
      ) : null}
      {rowState.interviewState.prepApplication ? (
        <InterviewPrepModal
          isOpen
          onClose={() => rowState.interviewState.setPrepApplication(undefined)}
          vacancy={{
            id: rowState.interviewState.prepApplication.id,
            title: cluster.canonicalTitle,
            company: cluster.canonicalCompany,
          }}
        />
      ) : null}
    </>
  );
}

export function VacancyRow(props: VacancyRowProps) {
  const { item, isSelected, onSelect, layout = 'default' } = props;
  const { cluster, explanation } = item;
  const rowState = useVacancyRowState(props);

  return (
    <li className={`vac-list-item${layout === 'screen' ? ' vacancies-screen-row-item' : ''}`}>
      <VacancyRowSummary
        layout={layout}
        cluster={cluster}
        explanation={explanation}
        isSelected={isSelected}
        alreadyApplied={rowState.alreadyApplied}
        applicationArchived={rowState.applicationArchived}
        age={rowState.age}
        trust={rowState.trust}
        onSelect={onSelect}
      />
      <VacancyCollectionActions {...props} />
      {isSelected ? (
        <VacancyRowDetail
          cluster={cluster}
          explanation={explanation}
          rowProps={props}
          rowState={rowState}
        />
      ) : null}
      <VacancyRowModals cluster={cluster} rowState={rowState} />
    </li>
  );
}
