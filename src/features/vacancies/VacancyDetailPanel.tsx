import { useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { ApplicationView } from '../applications/applicationsApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import type { VacancyApplications } from './useVacancyApplications';
import { VacancyPitchModal } from './VacancyPitchModal';
import { VacancyInfoModal } from './VacancyInfoModal';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
import { recruiterEnrichPayload } from './recruiterEnrichPayload';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';
import { vacancyLevelMatchLabel } from './vacancyLevelMatch';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';

/**
 * Детальная панель «Вакансии» (B248/B250) — макет `vacancies.html`. Сетка
 * «Стадия компании / Кто рекрутирует / Причина открытия роли / Подчинение»
 * рисует только то, что реально есть в `companyFeatures`: обогатитель этих
 * четырёх полей ещё не построен (`mockup-data-gap.md`), так что сегодня блок
 * скрыт целиком, а не подставляет пустые строки.
 */
interface VacancyDetailPanelProps {
  readonly item: MatchedVacancyItem;
  readonly now: string;
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
  readonly onBack: () => void;
  /** Opens «Отклики» after the candidate confirms an application (B251 F5,
   * C47): without this door the tracker card was reachable only by rail
   * click, and nothing told the candidate it existed. */
  readonly onOpenResponses?: () => void;
  /** Opens the profile so the candidate can add the experience that covers
   * the requirement; without a handler the button is not rendered. */
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
  /** Opens the contact window for this vacancy (B297): who works in the
   * company and the note to write. Nothing is sent by the product. */
  readonly onOpenNetworking?: () => void;
}

export function VacancyDetailPanel({
  item,
  now,
  applications,
  onMarkAlreadyApplied,
  onScheduleInterview,
  onBack,
  onOpenResponses,
  onAddToProfile,
  onOpenNetworking,
}: VacancyDetailPanelProps) {
  const { cluster, explanation } = item;
  const age = vacancyAge(cluster, now);
  const source = vacancySourceLabels(cluster.sources)[0];
  const signals = vacancySignals(cluster);
  const application = applications?.byCluster.get(cluster.id);
  return (
    <VacancyDetailPanelView
      cluster={cluster}
      explanation={explanation}
      age={age}
      source={source}
      signals={signals}
      alreadyApplied={application?.status === 'applied'}
      applications={applications}
      onMarkAlreadyApplied={onMarkAlreadyApplied}
      onScheduleInterview={onScheduleInterview}
      onBack={onBack}
      onOpenResponses={onOpenResponses}
      onAddToProfile={onAddToProfile}
      onOpenNetworking={onOpenNetworking}
    />
  );
}

interface VacancyDetailViewProps {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly age: ReturnType<typeof vacancyAge>;
  readonly source?: string;
  readonly signals: ReturnType<typeof vacancySignals>;
  readonly alreadyApplied: boolean;
  readonly applications?: VacancyApplications;
  readonly onMarkAlreadyApplied?: VacancyDetailPanelProps['onMarkAlreadyApplied'];
  readonly onScheduleInterview?: VacancyDetailPanelProps['onScheduleInterview'];
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onAddToProfile?: VacancyDetailPanelProps['onAddToProfile'];
  readonly onOpenNetworking?: VacancyDetailPanelProps['onOpenNetworking'];
}

function VacancyDetailPanelView(props: VacancyDetailViewProps) {
  const {
    cluster,
    explanation,
    age,
    source,
    signals,
    alreadyApplied,
    applications,
    onMarkAlreadyApplied,
    onScheduleInterview,
    onBack,
    onOpenResponses,
    onAddToProfile,
    onOpenNetworking,
  } = props;
  return (
    <div className="vacancies-detail-panel">
      <VacancyDetailHeader
        cluster={cluster}
        explanation={explanation}
        age={age}
        source={source}
        onBack={onBack}
      />
      <VacancyProfileEvidence
        cluster={cluster}
        explanation={explanation}
        signals={signals}
        onAddToProfile={onAddToProfile}
      />
      <VacancyRecruiterBlock cluster={cluster} />

      <VacancyDetailActions
        cluster={cluster}
        alreadyApplied={alreadyApplied}
        applications={applications}
        onMarkAlreadyApplied={onMarkAlreadyApplied}
        onScheduleInterview={onScheduleInterview}
        onOpenResponses={onOpenResponses}
        onOpenNetworking={onOpenNetworking}
      />
    </div>
  );
}

function VacancyDetailHeader({
  cluster,
  explanation,
  age,
  source,
  onBack,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly age: ReturnType<typeof vacancyAge>;
  readonly source?: string;
  readonly onBack: () => void;
}) {
  return (
    <>
      <button type="button" className="vacancies-detail-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Назад</span>
      </button>
      <VacancyDetailHead cluster={cluster} />
      <VacancyDetailMetaRow explanation={explanation} age={age} source={source} />
    </>
  );
}

function VacancyProfileEvidence({
  cluster,
  explanation,
  signals,
  onAddToProfile,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly signals: ReturnType<typeof vacancySignals>;
  readonly onAddToProfile?: VacancyDetailPanelProps['onAddToProfile'];
}) {
  return (
    <>
      <VacancySignalGrid signals={signals} />
      <div className="vacancies-detail-requirements">
        <VacancyRequirementList
          title="Совпадает по фактам профиля"
          points={explanation.matchingPoints}
          tone="yes"
        />
        <VacancyMissingRequirements
          cluster={cluster}
          points={explanation.missingPoints}
          onAddToProfile={onAddToProfile}
        />
      </div>

      <div className="vacancies-detail-description vacancies-req-block">
        <h4>Вилка</h4>
        <p className="vacancies-comp-note">{formatCompensationCompact(cluster.salary)}</p>
      </div>
    </>
  );
}

function VacancyMissingRequirements({
  cluster,
  points,
  onAddToProfile,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly points: readonly string[];
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
}) {
  return (
    <VacancyRequirementList
      title="Требования вакансии, которых нет в вашем профиле"
      subtitle="Подтвердите опытом в профиле — или будьте готовы обсудить на интервью"
      points={points}
      tone="no"
      actionLabel="Добавить в профиль"
      onAction={
        onAddToProfile
          ? (requirement) =>
              onAddToProfile({
                requirement,
                vacancyId: cluster.id,
                vacancyTitle: cluster.canonicalTitle,
                vacancyCompany: cluster.canonicalCompany,
              })
          : undefined
      }
    />
  );
}

function VacancyDetailHead({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <div className="vacancies-detail-head">
      <span className="vac-logo vacancies-detail-logo" aria-hidden="true">
        {logoInitials(cluster.canonicalCompany)}
      </span>
      <div>
        <h2 className="vacancies-detail-title">{cluster.canonicalTitle}</h2>
        <div className="vacancies-detail-company">
          {[
            cluster.canonicalCompany,
            cluster.canonicalLocation,
            cluster.isRemote ? 'удалённо' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
    </div>
  );
}

function VacancyDetailMetaRow({
  explanation,
  age,
  source,
}: {
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly age: ReturnType<typeof vacancyAge>;
  readonly source?: string;
}) {
  return (
    <div className="vacancies-detail-meta-row">
      <VacancyLevelChip match={explanation.levelMatch} />
      <span className="vacancies-chip vacancies-chip-success">
        {age.days === 0 ? 'Сегодня в базе' : `${age.label} в базе`}
      </span>
      {source ? <span className="vacancies-chip">Опубликована на {source}</span> : null}
    </div>
  );
}

function VacancyLevelChip({ match }: { readonly match: VacancyLevelMatch }) {
  const label = vacancyLevelMatchLabel(match);
  return (
    <span
      className={`vacancies-chip${match === 'match' ? ' is-selected' : ''}${match === 'unknown' ? ' is-unknown' : ''}`}
      title={label}
      aria-label={label}
    >
      {label}
    </span>
  );
}

/**
 * Compact «Кто нанимает» — the search itself and its result (contact list,
 * or an honest "not found"/error notice from `RecruiterContactsBlock`, never
 * a spinner that never resolves) sit under the matches, above the action
 * row (owner acceptance 2026-09-25).
 */
function VacancyRecruiterBlock({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <div className="vacancies-req-block vacancies-recruiter-block">
      <h4>Кто нанимает</h4>
      <RecruiterContactsBlock
        vacancyId={cluster.id}
        vacancyPayload={recruiterEnrichPayload(cluster)}
      />
    </div>
  );
}

interface VacancyActionProps {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly alreadyApplied: boolean;
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
  readonly onOpenResponses?: () => void;
  /** Opens the contact window: who is in the company and what to write. Without
   * a handler the candidate would have no way out of the vacancy (B297). */
  readonly onOpenNetworking?: () => void;
}

function NetworkingAction({ onOpenNetworking }: { readonly onOpenNetworking?: () => void }) {
  if (!onOpenNetworking) return null;
  return (
    <button
      type="button"
      className="vacancies-btn vacancies-btn-secondary"
      onClick={onOpenNetworking}
    >
      Нетворкинг
    </button>
  );
}

function VacancyDetailActions(props: VacancyActionProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="vacancies-detail-actions">
      <VacancyResponseAction {...props} />
      <InterviewScheduleAction {...props} />
      <NetworkingAction onOpenNetworking={props.onOpenNetworking} />
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => setInfoOpen(true)}
      >
        Подробнее
      </button>
      <VacancyPitchDoor cluster={props.cluster} />
      <VacancyInfoModal
        isOpen={infoOpen}
        onClose={() => setInfoOpen(false)}
        cluster={props.cluster}
      />
    </div>
  );
}

function VacancyResponseAction(props: VacancyActionProps) {
  return props.alreadyApplied ? (
    <AppliedStatus onOpenResponses={props.onOpenResponses} />
  ) : (
    <VacancyUnappliedActions
      cluster={props.cluster}
      applications={props.applications}
      onMarkAlreadyApplied={props.onMarkAlreadyApplied}
    />
  );
}

function VacancyUnappliedActions({
  cluster,
  applications,
  onMarkAlreadyApplied,
}: Pick<VacancyActionProps, 'cluster' | 'applications' | 'onMarkAlreadyApplied'>) {
  const [confirmationError, setConfirmationError] = useState<string>();
  return (
    <>
      <ExternalApplyButton
        cluster={cluster}
        applications={applications}
        showUnsavedError={!confirmationError}
        onApply={() => setConfirmationError(undefined)}
      />
      {onMarkAlreadyApplied ? (
        <ConfirmAlreadyAppliedButton
          cluster={cluster}
          onConfirm={onMarkAlreadyApplied}
          onErrorChange={setConfirmationError}
        />
      ) : null}
      {confirmationError ? (
        <p className="vacancies-interview-error" role="alert">
          {confirmationError}
        </p>
      ) : null}
    </>
  );
}

function ExternalApplyButton({
  cluster,
  applications,
  showUnsavedError,
  onApply,
}: Pick<VacancyActionProps, 'cluster' | 'applications'> & {
  readonly showUnsavedError: boolean;
  readonly onApply: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="vacancies-btn vacancies-btn-primary"
        onClick={() => {
          onApply();
          void openExternalLink(cluster.primaryUrl);
          applications?.record(cluster.id, 'applied', vacancySnapshot(cluster));
        }}
      >
        Откликнуться
      </button>
      {showUnsavedError && applications?.unsaved.has(cluster.id) ? (
        <p className="vacancies-interview-error" role="alert">
          Не удалось сохранить отклик. Состояние не изменено.
        </p>
      ) : null}
    </>
  );
}

function ConfirmAlreadyAppliedButton({
  cluster,
  onConfirm,
  onErrorChange,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly onConfirm: NonNullable<VacancyActionProps['onMarkAlreadyApplied']>;
  readonly onErrorChange: (error: string | undefined) => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <>
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        disabled={saving}
        aria-busy={saving}
        onClick={() =>
          runApplicationConfirmation(cluster, onConfirm, setSaving, onErrorChange)
        }
      >
        {saving ? 'Сохраняем…' : 'Я уже откликнулся'}
      </button>
    </>
  );
}

async function runApplicationConfirmation(
  cluster: MatchedVacancyItem['cluster'],
  onConfirm: NonNullable<VacancyActionProps['onMarkAlreadyApplied']>,
  setSaving: (saving: boolean) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  setSaving(true);
  setError(undefined);
  try {
    await onConfirm(cluster.id, vacancySnapshot(cluster));
  } catch {
    setError('Не удалось сохранить отклик. Состояние не изменено. Попробуйте ещё раз.');
  } finally {
    setSaving(false);
  }
}

function InterviewScheduleAction({
  cluster,
  alreadyApplied,
  onScheduleInterview,
}: Pick<VacancyActionProps, 'cluster' | 'alreadyApplied' | 'onScheduleInterview'>) {
  const [formOpen, setFormOpen] = useState(false);
  const [preparationApplication, setPreparationApplication] = useState<ApplicationView>();
  if (!alreadyApplied || !onScheduleInterview) return null;
  return (
    <>
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => setFormOpen(true)}
      >
        Назначили интервью
      </button>
      {formOpen ? (
        <InterviewAssignmentForm
          onCancel={() => setFormOpen(false)}
          onSubmit={(scheduledAt) =>
            onScheduleInterview(cluster.id, scheduledAt, vacancySnapshot(cluster))
          }
          onSaved={(application) => {
            setFormOpen(false);
            setPreparationApplication(application);
          }}
        />
      ) : null}
      {preparationApplication ? (
        <InterviewPrepModal
          isOpen
          onClose={() => setPreparationApplication(undefined)}
          vacancy={{
            id: preparationApplication.id,
            title: cluster.canonicalTitle,
            company: cluster.canonicalCompany,
          }}
        />
      ) : null}
    </>
  );
}

function InterviewAssignmentForm({
  onCancel,
  onSubmit,
  onSaved,
}: {
  readonly onCancel: () => void;
  readonly onSubmit: (scheduledAt: string) => Promise<ApplicationView>;
  readonly onSaved: (application: ApplicationView) => void;
}) {
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <form
      className="vacancies-interview-assignment"
      aria-label="Назначить интервью"
      aria-busy={saving}
      onSubmit={(event) =>
        void submitInterviewSchedule(event, scheduledLocal, onSubmit, onSaved, setSaving, setError)
      }
    >
      <label>
        Дата и время интервью
        <input
          type="datetime-local"
          required
          value={scheduledLocal}
          onChange={(event) => setScheduledLocal(event.target.value)}
        />
      </label>
      {error ? (
        <p className="vacancies-interview-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="vacancies-interview-actions">
        <button type="button" className="vacancies-btn vacancies-btn-secondary" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="submit"
          className="vacancies-btn vacancies-btn-primary"
          disabled={!scheduledLocal || saving}
        >
          {saving ? 'Сохраняем…' : 'Сохранить и открыть подготовку'}
        </button>
      </div>
    </form>
  );
}

async function submitInterviewSchedule(
  event: FormEvent<HTMLFormElement>,
  scheduledLocal: string,
  onSubmit: (scheduledAt: string) => Promise<ApplicationView>,
  onSaved: (application: ApplicationView) => void,
  setSaving: (saving: boolean) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  event.preventDefault();
  if (!scheduledLocal) return;
  const scheduledAt = new Date(scheduledLocal);
  if (Number.isNaN(scheduledAt.getTime())) {
    setError('Проверьте дату и время интервью.');
    return;
  }
  setSaving(true);
  setError(undefined);
  try {
    onSaved(await onSubmit(scheduledAt.toISOString()));
  } catch {
    setError('Не удалось назначить интервью. Этап не изменён. Попробуйте ещё раз.');
  } finally {
    setSaving(false);
  }
}

function vacancySnapshot(
  cluster: MatchedVacancyItem['cluster'],
): VacancyApplicationSnapshot {
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };
}

/** Chip plus the door to «Отклики» (B251 F5, C47): confirming an application
 * has to tell the candidate the tracker card exists, not just stop talking. */
function AppliedStatus({
  onOpenResponses,
}: {
  readonly onOpenResponses?: () => void;
}) {
  return (
    <>
      <span className="vacancies-chip is-selected vacancies-detail-applied">
        Отклик отмечен
      </span>
      {onOpenResponses ? (
        <button
          type="button"
          className="vacancies-btn vacancies-btn-secondary"
          onClick={onOpenResponses}
        >
          Перейти в «Отклики»
        </button>
      ) : null}
    </>
  );
}

/** The old board's cover-letter door (B232): the new screen must not drop a
 *  feature the candidate already had on prod. */
function VacancyPitchDoor({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  const [pitchOpen, setPitchOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => setPitchOpen(true)}
      >
        Сопроводительное письмо
      </button>
      {pitchOpen ? (
        <VacancyPitchModal
          isOpen
          onClose={() => setPitchOpen(false)}
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
    </>
  );
}

function logoInitials(company: string): string {
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .filter(Boolean);
  return letters.slice(0, 2).join('') || '—';
}

interface VacancySignal {
  readonly label: string;
  readonly value: string;
}

/**
 * Сегодня `companyFeatures` не несёт ни одного из четырёх полей карточки
 * (стадия компании/рекрутер/причина открытия/подчинение) — обогатитель ещё
 * не построен. Функция уже перечисляет их, чтобы включить блок одним местом,
 * когда бэкенд начнёт присылать значения, вместо выдумывания данных сейчас.
 */
function vacancySignals(cluster: MatchedVacancyItem['cluster']): readonly VacancySignal[] {
  void cluster;
  return [];
}

function VacancySignalGrid({
  signals,
}: {
  readonly signals: readonly { readonly label: string; readonly value: string }[];
}) {
  if (signals.length === 0) return null;
  return (
    <dl className="vacancies-signals">
      {signals.map(({ label, value }) => (
        <div className="vacancies-signal" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function VacancyRequirementList({
  title,
  subtitle,
  points,
  tone,
  actionLabel,
  onAction,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly points: readonly string[];
  readonly tone: 'yes' | 'no';
  readonly actionLabel?: string;
  readonly onAction?: (point: string) => void;
}) {
  if (points.length === 0) return null;
  const Icon = tone === 'yes' ? Check : Warning;
  return (
    <div className="vacancies-req-block">
      <h4>{title}</h4>
      {subtitle ? <p className="vacancies-req-subtitle">{subtitle}</p> : null}
      <ul className="vacancies-req-list">
        {points.map((point) => (
          <li className={`vacancies-req-${tone}`} key={point}>
            <div className="vacancies-req-item-main">
              <Icon size={14} weight="bold" aria-hidden="true" />
              <span>{point}</span>
            </div>
            {actionLabel && onAction ? (
              <button
                type="button"
                className="vacancies-req-action-btn"
                onClick={() => onAction(point)}
              >
                {actionLabel}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
