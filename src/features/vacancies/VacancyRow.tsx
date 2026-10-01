import { useState, type FormEvent } from 'react';
import { CaretDown, CaretUp, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import { vacancyTrustSignals } from '../../../shared/vacancyTrustSignals';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
import { recruiterEnrichPayload } from './recruiterEnrichPayload';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { VacancyInfoModal } from './VacancyInfoModal';
import { VacancyPitchModal } from './VacancyPitchModal';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { RoleFitDot, LevelFitDot, GeoFitDot } from './VacancyFitDots';
import type { VacancyApplications } from './useVacancyApplications';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import type { ApplicationView } from '../applications/applicationsApi';

export interface VacancyRowProps {
  readonly item: MatchedVacancyItem;
  readonly now: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly applications?: VacancyApplications;
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
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
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

function vacancySnapshot(cluster: MatchedVacancyItem['cluster']): VacancyApplicationSnapshot {
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };
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
          Требования: <span className="num">{matching} из {total}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="vac-req is-none">
      <Warning size={14} aria-hidden="true" />
      <span>
        Требования: не совпали (<span className="num">0 из {missing}</span>)
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

function VacancyRowMeta({
  comp,
  age,
  alreadyApplied,
}: {
  readonly comp: string;
  readonly age: ReturnType<typeof vacancyAge>;
  readonly alreadyApplied: boolean;
}) {
  const ageText = age.days === 0 ? 'сегодня' : age.label;
  return (
    <span>
      <span className="vac-comp">{comp}</span>
      <span className="vac-age">
        {alreadyApplied
          ? `Отклик отмечен · ${age.days === 0 ? 'сегодня' : `${age.label} назад`}`
          : `в базе ${ageText}`}
      </span>
    </span>
  );
}

interface SummaryProps {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly isSelected: boolean;
  readonly alreadyApplied: boolean;
  readonly age: ReturnType<typeof vacancyAge>;
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
  readonly onSelect: () => void;
}

function VacancyRowSummary({
  cluster,
  explanation,
  isSelected,
  alreadyApplied,
  age,
  trust,
  onSelect,
}: SummaryProps) {
  const matchingCount = explanation.matchingPoints?.length ?? 0;
  const missingCount = explanation.missingPoints?.length ?? 0;
  const total = matchingCount + missingCount;

  return (
    <button
      type="button"
      className={`vac-row${isSelected ? ' is-selected' : ''}${alreadyApplied ? ' is-applied' : ''}`}
      aria-pressed={isSelected}
      aria-expanded={isSelected}
      onClick={onSelect}
    >
      <span className="vac-logo" aria-hidden="true">
        {logoInitials(cluster.canonicalCompany)}
      </span>
      <span className="vac-main">
        <span className="vac-title-col">
          <span className="vac-title">{cluster.canonicalTitle}</span>
          <span className="vac-sub">{vacancySubtitle(cluster)}</span>
          <VacancyReqTag matching={matchingCount} total={total} missing={missingCount} />
          <VacancyTrustTag trust={trust} />
        </span>

        <VacancyRowMeta
          comp={formatCompensationCompact(cluster.salary)}
          age={age}
          alreadyApplied={alreadyApplied}
        />

        <span className="vac-fit">
          <RoleFitDot roleMatch={explanation.roleMatch} adjacent={explanation.adjacentRole} />
          <LevelFitDot levelMatch={explanation.levelMatch} />
          <GeoFitDot outsideGeo={explanation.outsideGeography} />
        </span>
      </span>

      {isSelected ? (
        <CaretUp className="vac-chevron" size={16} aria-hidden="true" />
      ) : (
        <CaretDown className="vac-chevron" size={16} aria-hidden="true" />
      )}
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
  readonly matchingPoints: string[];
  readonly missingPoints: string[];
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

function AppliedActions({
  onOpenResponses,
  onToggleSchedule,
}: {
  readonly onOpenResponses?: () => void;
  readonly onToggleSchedule?: () => void;
}) {
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

function NotAppliedActions({
  savingApplied,
  externalOpened,
  onApplyExternal,
  onConfirmSent,
  onConfirmAlreadyApplied,
}: {
  readonly savingApplied: boolean;
  readonly externalOpened: boolean;
  readonly onApplyExternal: () => void;
  readonly onConfirmSent: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
}) {
  if (externalOpened) {
    return (
      <button type="button" className="btn btn-primary action-btn" onClick={onConfirmSent}>
        Да, отклик отправлен
      </button>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-primary action-btn" onClick={onApplyExternal}>
        Откликнуться
      </button>
      {onConfirmAlreadyApplied ? (
        <button
          type="button"
          className="btn btn-secondary action-btn"
          disabled={savingApplied}
          onClick={onConfirmAlreadyApplied}
        >
          {savingApplied ? 'Сохраняем…' : 'Я уже откликнулся'}
        </button>
      ) : null}
    </>
  );
}

interface ActionButtonsProps {
  readonly alreadyApplied: boolean;
  readonly savingApplied: boolean;
  readonly onOpenResponses?: () => void;
  readonly onToggleSchedule?: () => void;
  readonly externalOpened: boolean;
  readonly onApplyExternal: () => void;
  readonly onConfirmSent: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
  readonly onOpenNetworking?: () => void;
  readonly onOpenInfo: () => void;
  readonly onOpenPitch: () => void;
}

function VacancyActionButtons({
  alreadyApplied,
  savingApplied,
  onOpenResponses,
  onToggleSchedule,
  externalOpened,
  onApplyExternal,
  onConfirmSent,
  onConfirmAlreadyApplied,
  onOpenNetworking,
  onOpenInfo,
  onOpenPitch,
}: ActionButtonsProps) {
  return (
    <div className="action-row vacancies-detail-actions">
      {alreadyApplied ? (
        <AppliedActions onOpenResponses={onOpenResponses} onToggleSchedule={onToggleSchedule} />
      ) : (
        <NotAppliedActions
          savingApplied={savingApplied}
          externalOpened={externalOpened}
          onApplyExternal={onApplyExternal}
          onConfirmSent={onConfirmSent}
          onConfirmAlreadyApplied={onConfirmAlreadyApplied}
        />
      )}

      {onOpenNetworking ? (
        <button type="button" className="btn btn-secondary action-btn" onClick={onOpenNetworking}>
          Нетворкинг
        </button>
      ) : null}

      <button type="button" className="btn btn-secondary action-btn" onClick={onOpenInfo}>
        Подробнее
      </button>

      <button type="button" className="btn btn-secondary action-btn" onClick={onOpenPitch}>
        Сопроводительное письмо
      </button>
    </div>
  );
}

function VacancyInterviewForm({
  scheduledLocal,
  savingSchedule,
  scheduleError,
  onChangeDate,
  onClose,
  onSubmit,
}: {
  readonly scheduledLocal: string;
  readonly savingSchedule: boolean;
  readonly scheduleError?: string;
  readonly onChangeDate: (val: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form
      className="vacancies-interview-assignment"
      aria-label="Назначить интервью"
      onSubmit={onSubmit}
    >
      <label>
        Дата и время интервью
        <input
          type="datetime-local"
          required
          value={scheduledLocal}
          onChange={(e) => onChangeDate(e.target.value)}
        />
      </label>
      {scheduleError ? (
        <p className="vacancies-interview-error" role="alert">
          {scheduleError}
        </p>
      ) : null}
      <div className="action-row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Отмена
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!scheduledLocal || savingSchedule}
        >
          {savingSchedule ? 'Сохраняем…' : 'Сохранить и открыть подготовку'}
        </button>
      </div>
    </form>
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
      const res = await onScheduleInterview(cluster.id, date.toISOString(), vacancySnapshot(cluster));
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
  onMarkAlreadyApplied,
  onScheduleInterview,
}: VacancyRowProps) {
  const { cluster } = item;
  const [infoOpen, setInfoOpen] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);
  const interviewState = useVacancyRowInterview(cluster, onScheduleInterview);
  const appliedState = useVacancyRowApplied(cluster, onMarkAlreadyApplied);
  const application = applications?.byCluster.get(cluster.id);

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
    alreadyApplied: application?.status === 'applied',
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

function DetailTrustAlert({
  trust,
}: {
  readonly trust: ReturnType<typeof vacancyTrustSignals>;
}) {
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

function VacancyRowDetail({ cluster, explanation, rowProps, rowState }: DetailProps) {
  const matchingPoints = explanation.matchingPoints ?? [];
  const missingPoints = explanation.missingPoints ?? [];
  const total = matchingPoints.length + missingPoints.length;
  const { interviewState, appliedState, trust } = rowState;
  const source = vacancySourceLabels(cluster.sources)[0];

  return (
    <div className="vac-detail vacancies-detail-col vacancies-detail-panel">
      <DetailTrustAlert trust={trust} />
      {source ? <p className="vac-sub vac-source">Опубликована на {source}</p> : null}
      <p className="req-summary">
        {total > 0
          ? `Требования вакансии: ${matchingPoints.length} из ${total} подтверждены фактами профиля`
          : 'Требования вакансии не указаны в явном виде'}
      </p>

      <VacancyDetailGrid
        cluster={cluster}
        matchingPoints={matchingPoints}
        missingPoints={missingPoints}
        onAddToProfile={rowProps.onAddToProfile}
      />

      <RecruiterSection cluster={cluster} />

      <VacancyActionButtons
        alreadyApplied={rowState.alreadyApplied}
        savingApplied={appliedState.savingApplied}
        onOpenResponses={rowProps.onOpenResponses}
        onToggleSchedule={
          rowProps.onScheduleInterview
            ? () => interviewState.setScheduleOpen((prev) => !prev)
            : undefined
        }
        {...externalApplyProps(rowState)}
        onConfirmAlreadyApplied={
          rowProps.onMarkAlreadyApplied
            ? () => void appliedState.handleConfirmAlreadyApplied()
            : undefined
        }
        onOpenNetworking={
          rowProps.onOpenNetworking ? () => rowProps.onOpenNetworking!(cluster) : undefined
        }
        onOpenInfo={() => rowState.setInfoOpen(true)}
        onOpenPitch={() => rowState.setPitchOpen(true)}
      />

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
  const { item, isSelected, onSelect } = props;
  const { cluster, explanation } = item;
  const rowState = useVacancyRowState(props);

  return (
    <li className="vac-list-item">
      <VacancyRowSummary
        cluster={cluster}
        explanation={explanation}
        isSelected={isSelected}
        alreadyApplied={rowState.alreadyApplied}
        age={rowState.age}
        trust={rowState.trust}
        onSelect={onSelect}
      />

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
