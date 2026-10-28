import {
  ArrowClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Info,
  LockSimple,
  ShieldCheck,
  TrashSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  FOOTPRINT_ADAPTER_REGISTRY,
  type CandidateFootprintAdapterStatus,
  type CandidateFootprintAudit,
  type CandidateFootprintConsentState,
  type CandidateFootprintFinding,
  type FootprintAdapterId,
  type FootprintAdapterRegistryItem,
  type FootprintReview,
  type SourceCapabilityStatus,
} from '../../../shared/candidateFootprint';
import type { PublicFootprintQueryPlanItem } from '../../../server/osint/candidateFootprintQueryPlan';
import { CAPABILITY_CONSENT_DOCUMENTS } from '../legal/capabilityConsents';
import {
  buildFootprintChecklist,
  type FootprintMetadataCheck,
} from '../../../shared/footprintChecklist';
import { FootprintPrivacyDialog } from './FootprintPrivacyDialog';
import {
  FootprintSanitationChecklist,
  type FootprintManualMark,
} from './FootprintSanitationChecklist';
import { statusMessage } from './candidateFootprintApi';
/* Keep the consent, audit and result steps beside the single stateful surface they form. */
/* eslint max-lines: ["error", 1300] */
import './profileFootprint.css';

const ADAPTER_IDS: readonly FootprintAdapterId[] = [
  'sherlock',
  'maigret',
  'hibp',
  'wayback',
  'exa',
];

const ADAPTER_LABELS: Readonly<Record<FootprintAdapterId, string>> = {
  sherlock: 'Профили по никнейму',
  maigret: 'Профили по никнейму: расширенная проверка',
  hibp: 'Утечки почты',
  wayback: 'Старые версии страниц',
  exa: 'Упоминания в открытом вебе',
};

export interface CandidateFootprintAuditSurfaceProps {
  readonly plan: readonly PublicFootprintQueryPlanItem[];
  readonly unidentifiedEmployers?: readonly string[];
  readonly sourceAvailability: Readonly<Record<FootprintAdapterId, boolean>>;
  readonly adapterRegistry?: readonly FootprintAdapterRegistryItem[];
  readonly consent: CandidateFootprintConsentState;
  readonly audit: CandidateFootprintAudit | null;
  readonly selectedQueryIds: ReadonlySet<string>;
  readonly loading?: boolean;
  readonly starting?: boolean;
  readonly grantingConsent?: boolean;
  readonly ownershipConfirmed?: boolean;
  readonly busyFindingId?: string;
  readonly confirmingDelete?: boolean;
  readonly deleting?: boolean;
  readonly revokingConsent?: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onRetry: () => void;
  readonly onToggleQuery: (id: string, selected: boolean) => void;
  readonly onConfirmOwnership: (confirmed: boolean) => void;
  readonly onGrantConsent: () => void;
  readonly onRevokeConsent: () => void;
  readonly onStart: () => void;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onAddManualEmployer?: (employer: string) => void;
  readonly onMarkFinding?: (findingId: string, mark: FootprintManualMark) => void;
  readonly onAddToProfile?: (findingId: string) => void;
  /** «Пересобрать PDF» leads to «Резюме и версии»; without it the item shows status only. */
  readonly onOpenResumeVersions?: () => void;
  /** B544: the resume-file metadata check; null until it answers. */
  readonly metadataCheck?: FootprintMetadataCheck | null;
}
function adapterState(
  adapterId: FootprintAdapterId,
  audit: CandidateFootprintAudit | null,
  availability: Readonly<Record<FootprintAdapterId, boolean>>,
): CandidateFootprintAdapterStatus {
  const existing = audit?.adapterStatuses.find((status) => status.adapterId === adapterId);
  if (existing?.state === 'not_run' && !availability[adapterId]) {
    return { ...existing, state: 'not_connected' };
  }
  return (
    existing ?? {
      adapterId,
      state: availability[adapterId] ? 'not_run' : 'not_connected',
      sourcesChecked: 0,
      findingsCount: 0,
    }
  );
}

function adapterIcon(state: CandidateFootprintAdapterStatus['state']) {
  if (state === 'pending') return CircleNotch;
  if (state === 'checked') return CheckCircle;
  if (state === 'source_error') return WarningCircle;
  if (state === 'not_connected') return Info;
  return ShieldCheck;
}

function statusClass(state: CandidateFootprintAdapterStatus['state']): string {
  if (state === 'checked') return 'is-checked';
  if (state === 'pending') return 'is-pending';
  if (state === 'source_error') return 'is-error';
  if (state === 'not_connected') return 'is-unavailable';
  return 'is-idle';
}

export interface SourceCapabilityProps {
  readonly title: string;
  readonly status: SourceCapabilityStatus;
  readonly detail?: string;
}

export function SourceCapability({ title, status }: SourceCapabilityProps): JSX.Element {
  const Icon = status === 'available' ? CheckCircle : status === 'prepared' ? Info : CircleNotch;
  const label =
    status === 'available' ? 'доступно' : status === 'prepared' ? 'подготовлено' : 'в планах';
  return (
    <li className={`career-footprint-status-row is-${status}`}>
      <Icon aria-hidden="true" />
      <span className="career-footprint-status-name">{title}</span>
      <span className="career-footprint-status-label">{label}</span>
    </li>
  );
}

function AdapterStatusList({
  audit,
  sourceAvailability,
  adapterRegistry = FOOTPRINT_ADAPTER_REGISTRY,
}: Pick<CandidateFootprintAuditSurfaceProps, 'audit' | 'sourceAvailability' | 'adapterRegistry'>) {
  return (
    <section className="career-footprint-status-section" aria-labelledby="footprint-status-title">
      <h3 id="footprint-status-title">Состояние источников</h3>
      <ul className="career-footprint-status-list">
        {ADAPTER_IDS.map((adapterId) => {
          const status = adapterState(adapterId, audit, sourceAvailability);
          const StatusIcon = adapterIcon(status.state);
          return (
            <li
              key={adapterId}
              className={`career-footprint-status-row ${statusClass(status.state)}`}
            >
              <StatusIcon aria-hidden="true" />
              <span className="career-footprint-status-name">{ADAPTER_LABELS[adapterId]}</span>
              <span className="career-footprint-status-label">{statusMessage(status)}</span>
            </li>
          );
        })}
        {adapterRegistry.map((item) => (
          <SourceCapability
            key={item.id}
            title={item.title}
            status={item.status}
            detail={item.description}
          />
        ))}
      </ul>
    </section>
  );
}

function ManualEmployerForm({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (employer: string) => void;
}) {
  const [value, setValue] = useState('');
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue('');
    }
  };
  return (
    <form className="career-footprint-manual-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="career-footprint-manual-input"
        placeholder="Название компании"
        aria-label="Название компании для ручного ввода"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="submit"
        className="career-footprint-secondary-button"
        disabled={disabled || !value.trim()}
      >
        Ввести вручную
      </button>
    </form>
  );
}

function UnidentifiedEmployersList({
  unidentifiedEmployers,
  onAddManualEmployer,
  disabled,
}: {
  readonly unidentifiedEmployers?: readonly string[];
  readonly onAddManualEmployer?: (employer: string) => void;
  readonly disabled: boolean;
}) {
  if (!unidentifiedEmployers?.length) return null;
  return (
    <div
      className="career-footprint-unidentified"
      role="region"
      aria-labelledby="footprint-unidentified-title"
    >
      <div className="career-footprint-unidentified-header">
        <WarningCircle aria-hidden="true" />
        <h4 id="footprint-unidentified-title">Не удалось определить компанию</h4>
      </div>
      <p>
        Описания из опыта работы не попали в план поиска. Вы можете ввести название компании
        вручную.
      </p>
      <ul>
        {unidentifiedEmployers.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {onAddManualEmployer ? (
        <ManualEmployerForm disabled={disabled} onAdd={onAddManualEmployer} />
      ) : null}
    </div>
  );
}

function QueryPlanList({
  plan,
  selectedQueryIds,
  disabled,
  onToggleQuery,
}: Pick<CandidateFootprintAuditSurfaceProps, 'plan' | 'selectedQueryIds' | 'onToggleQuery'> & {
  readonly disabled: boolean;
}) {
  if (!plan.length) {
    return (
      <div className="career-footprint-empty-plan" role="status">
        <Info aria-hidden="true" />
        <p>В профиле пока нет имени, почты или публичных ссылок для плана проверки.</p>
      </div>
    );
  }
  return (
    <fieldset className="career-footprint-query-list" disabled={disabled}>
      <legend className="career-sr-only">Выберите данные для проверки</legend>
      {plan.map((item) => (
        <label
          key={item.id}
          className={`career-footprint-query ${item.available ? '' : 'is-unavailable'}`}
        >
          <input
            type="checkbox"
            checked={selectedQueryIds.has(item.id)}
            disabled={!item.available || disabled}
            onChange={(event) => onToggleQuery(item.id, event.currentTarget.checked)}
          />
          <span className="career-footprint-query-copy">
            <span>{item.preview}</span>
            {!item.available ? <small>подготовлено, не подключено</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function QueryPlanSection({
  plan,
  unidentifiedEmployers,
  onAddManualEmployer,
  selectedQueryIds,
  disabled,
  onToggleQuery,
}: Pick<
  CandidateFootprintAuditSurfaceProps,
  'plan' | 'unidentifiedEmployers' | 'onAddManualEmployer' | 'selectedQueryIds' | 'onToggleQuery'
> & {
  readonly disabled: boolean;
}) {
  return (
    <section className="career-footprint-plan" aria-labelledby="footprint-plan-title">
      <div className="career-footprint-section-heading">
        <div>
          <h3 id="footprint-plan-title">План запросов</h3>
          <p>Снимите отметку у тех запросов, которые не хотите запускать.</p>
        </div>
        <span className="career-footprint-count">
          <span className="career-numeric">{selectedQueryIds.size}</span> выбрано
        </span>
      </div>
      <QueryPlanList
        plan={plan}
        selectedQueryIds={selectedQueryIds}
        disabled={disabled}
        onToggleQuery={onToggleQuery}
      />
      <UnidentifiedEmployersList
        unidentifiedEmployers={unidentifiedEmployers}
        onAddManualEmployer={onAddManualEmployer}
        disabled={disabled}
      />
    </section>
  );
}

function ConsentItemsList({
  className = 'profile-footprint-consent-items',
}: {
  readonly className?: string;
} = {}) {
  const document = CAPABILITY_CONSENT_DOCUMENTS.digital_footprint;
  return (
    <ul className={className}>
      {document.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

type ConsentDisclosureProps = Pick<CandidateFootprintConsentState, 'approved' | 'granted'> &
  Pick<
    CandidateFootprintAuditSurfaceProps,
    | 'ownershipConfirmed'
    | 'grantingConsent'
    | 'revokingConsent'
    | 'onConfirmOwnership'
    | 'onGrantConsent'
    | 'onRevokeConsent'
  >;

function PendingConsent(): JSX.Element {
  return (
    <div className="career-footprint-consent is-pending" role="status" aria-live="polite">
      <WarningCircle aria-hidden="true" />
      <p>Текст согласия ждёт утверждения.</p>
    </div>
  );
}

function GrantedConsent({
  revokingConsent,
  onRevokeConsent,
}: Pick<ConsentDisclosureProps, 'revokingConsent' | 'onRevokeConsent'>): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="career-footprint-consent" aria-label="Согласие на цифровой след">
      <p role="status">
        Согласие выдано. Отзыв остановит текущую проверку и удалит сохранённые находки.
      </p>
      {confirming ? (
        <div
          className="career-footprint-delete-confirm"
          role="group"
          aria-label="Подтвердить отзыв"
        >
          <p>Отозвать согласие? Проверка остановится, сохранённые находки будут удалены.</p>
          <div>
            <button type="button" disabled={revokingConsent} onClick={() => setConfirming(false)}>
              Отмена
            </button>
            <button
              type="button"
              disabled={revokingConsent}
              aria-busy={revokingConsent}
              onClick={onRevokeConsent}
            >
              {revokingConsent ? 'Отзываем согласие' : 'Отозвать согласие'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="career-footprint-secondary-button"
          onClick={() => setConfirming(true)}
        >
          Отозвать согласие
        </button>
      )}
    </section>
  );
}

function ConsentGrantForm({
  ownershipConfirmed,
  grantingConsent,
  onConfirmOwnership,
  onGrantConsent,
}: Pick<
  ConsentDisclosureProps,
  'ownershipConfirmed' | 'grantingConsent' | 'onConfirmOwnership' | 'onGrantConsent'
>): JSX.Element {
  return (
    <section className="career-footprint-consent" aria-label="Выдать согласие на цифровой след">
      <label className="career-footprint-ownership">
        <input
          type="checkbox"
          checked={Boolean(ownershipConfirmed)}
          onChange={(event) => onConfirmOwnership(event.currentTarget.checked)}
        />
        <span>Подтверждаю, что выбранные ссылки, никнеймы и почта принадлежат мне.</span>
      </label>
      <button
        type="button"
        className="career-footprint-secondary-button"
        disabled={!ownershipConfirmed || grantingConsent}
        aria-busy={grantingConsent}
        onClick={onGrantConsent}
      >
        {grantingConsent ? 'Сохраняем согласие' : 'Выдать согласие'}
      </button>
    </section>
  );
}

function ConsentDisclosure(props: ConsentDisclosureProps): JSX.Element {
  if (!props.approved) return <PendingConsent />;
  if (props.granted) return <GrantedConsent {...props} />;
  return <ConsentGrantForm {...props} />;
}

/** «06.10» — the short date the approved mockup uses on findings and step tiles. */
function shortDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function ProfileFootprintReviewSegments({
  finding,
  busy,
  onReview,
}: {
  readonly finding: CandidateFootprintFinding;
  readonly busy: boolean;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
}) {
  return (
    <div className="profile-footprint-review-segments" role="group" aria-label="Отметить находку">
      <button
        type="button"
        aria-pressed={finding.review === 'confirmed_self'}
        disabled={busy}
        onClick={() =>
          onReview(
            finding.id,
            finding.review === 'confirmed_self' ? 'unreviewed' : 'confirmed_self',
          )
        }
      >
        <Check aria-hidden="true" />
        Это я
      </button>
      <button
        type="button"
        aria-pressed={finding.review === 'not_self'}
        disabled={busy}
        onClick={() =>
          onReview(finding.id, finding.review === 'not_self' ? 'unreviewed' : 'not_self')
        }
      >
        <X aria-hidden="true" />
        Не я
      </button>
    </div>
  );
}

/**
 * Mockup 2, «Цифровой след»: one row per finding — what was found, when the scan found it and
 * why it may be the candidate — with «Это я» / «Не я». 390 keeps the reason line only.
 */
function FindingRow({
  finding,
  busy,
  onReview,
}: {
  readonly finding: CandidateFootprintFinding;
  readonly busy: boolean;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
}) {
  const found = shortDate(finding.observedAt);
  const detail = finding.detail.trim().replace(/[.。]$/u, '');
  return (
    <li className="profile-footprint-find">
      <div className="profile-footprint-find-copy">
        <strong>
          {finding.url ? (
            <a href={finding.url} target="_blank" rel="noopener noreferrer">
              {finding.title}
            </a>
          ) : (
            finding.title
          )}
        </strong>
        <p>
          {found ? (
            <span className="profile-footprint-find-when">Найдено сканированием {found}. </span>
          ) : null}
          {detail}
          <span className="profile-footprint-find-when">.</span>
        </p>
      </div>
      <ProfileFootprintReviewSegments finding={finding} busy={busy} onReview={onReview} />
    </li>
  );
}

function FindingsSection({
  audit,
  busyFindingId,
  onReview,
}: Pick<CandidateFootprintAuditSurfaceProps, 'audit' | 'busyFindingId' | 'onReview'>) {
  if (!audit || audit.state === 'pending') return null;
  const findings = audit.findings;
  return (
    <section className="career-footprint-findings" aria-labelledby="footprint-findings-title">
      <h3 id="footprint-findings-title" className="career-sr-only">
        Находки
      </h3>
      {findings.length ? (
        <ul className="profile-footprint-finds">
          {findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              busy={busyFindingId === finding.id}
              onReview={onReview}
            />
          ))}
        </ul>
      ) : (
        <div className="career-footprint-empty-results" role="status">
          <ShieldCheck aria-hidden="true" />
          <p>По выбранным источникам новых находок нет.</p>
        </div>
      )}
      <p className="profile-footprint-find-note">
        До подтверждения находки не попадают в профиль и не используются в откликах.
      </p>
    </section>
  );
}

function DeleteConfirmation({
  confirmingDelete,
  deleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: Pick<
  CandidateFootprintAuditSurfaceProps,
  'confirmingDelete' | 'deleting' | 'onRequestDelete' | 'onCancelDelete' | 'onConfirmDelete'
>) {
  if (!confirmingDelete) {
    return (
      <button type="button" className="career-footprint-delete-trigger" onClick={onRequestDelete}>
        <TrashSimple aria-hidden="true" />
        Удалить сохранённые находки
      </button>
    );
  }
  return (
    <div className="career-footprint-delete-confirm" role="group" aria-label="Подтвердить удаление">
      <p>Удалить все сохранённые находки и историю проверок? Запуск придётся выполнить заново.</p>
      <div>
        <button type="button" disabled={deleting} onClick={onCancelDelete}>
          Отмена
        </button>
        <button type="button" disabled={deleting} onClick={onConfirmDelete}>
          {deleting ? 'Удаляем находки' : 'Удалить все находки'}
        </button>
      </div>
    </div>
  );
}

function FootprintSurfaceFeedback({
  error,
  notice,
  onRetry,
}: {
  readonly error?: string;
  readonly notice?: string;
  readonly onRetry: () => void;
}) {
  return (
    <>
      {error ? (
        <div className="career-footprint-alert" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            <ArrowClockwise aria-hidden="true" />
            Повторить
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="career-footprint-notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}

function OwnershipConfirmation({
  ownershipConfirmed,
  disabled,
  onConfirm,
}: {
  readonly ownershipConfirmed: boolean;
  readonly disabled: boolean;
  readonly onConfirm: (confirmed: boolean) => void;
}) {
  return (
    <label className="career-footprint-ownership">
      <input
        type="checkbox"
        checked={ownershipConfirmed}
        onChange={(event) => onConfirm(event.currentTarget.checked)}
        disabled={disabled}
      />
      <span>Подтверждаю, что выбранные ссылки, никнеймы и почта принадлежат мне.</span>
    </label>
  );
}

function FootprintLaunchActions(props: CandidateFootprintAuditSurfaceProps) {
  const running = Boolean(props.starting || props.audit?.state === 'pending');
  const availableSelection = props.plan.some(
    (item) => item.available && props.selectedQueryIds.has(item.id),
  );
  const canStart = Boolean(
    props.consent.approved &&
    props.consent.granted &&
    props.ownershipConfirmed &&
    availableSelection &&
    !running,
  );
  const launchLabel = running
    ? 'Проверка выполняется'
    : !props.consent.approved
      ? 'Ждёт утверждения текста согласия'
      : !props.consent.granted
        ? 'Сначала выдайте согласие'
        : !props.ownershipConfirmed
          ? 'Подтвердите, что данные ваши'
          : 'Запустить выбранные проверки';
  return (
    <div className="career-footprint-actions">
      <button
        type="button"
        className="career-footprint-primary-button"
        disabled={!canStart}
        aria-busy={running}
        onClick={props.onStart}
      >
        {running ? <CircleNotch aria-hidden="true" className="spin" /> : null}
        {launchLabel}
      </button>
    </div>
  );
}

function FootprintPlanControls(props: CandidateFootprintAuditSurfaceProps) {
  const running = props.audit?.state === 'pending';
  return (
    <>
      <QueryPlanSection
        plan={props.plan}
        unidentifiedEmployers={props.unidentifiedEmployers}
        onAddManualEmployer={props.onAddManualEmployer}
        selectedQueryIds={props.selectedQueryIds}
        disabled={Boolean(props.loading || running)}
        onToggleQuery={props.onToggleQuery}
      />
      <p className="career-footprint-disclosure">
        Ищем только по тому, что вы отметили. Полный адрес почты и пароль никуда не передаются, по
        фото из профиля в интернете не ищем, в ваши аккаунты не входим.
      </p>
      <AdapterStatusList
        audit={props.audit}
        sourceAvailability={props.sourceAvailability}
        adapterRegistry={props.adapterRegistry}
      />
      <FootprintLaunchActions {...props} />
    </>
  );
}

function FootprintAuditFeedback(props: CandidateFootprintAuditSurfaceProps) {
  const running = Boolean(props.starting || props.audit?.state === 'pending');
  return (
    <>
      {running ? (
        <div className="career-footprint-running" role="status" aria-live="polite">
          <CircleNotch aria-hidden="true" className="spin" />
          <span>Источники проверяются в фоне. Страница остаётся доступной.</span>
        </div>
      ) : null}
      {props.loading ? (
        <div className="career-footprint-loading" role="status" aria-busy="true">
          Загружаем план проверки.
        </div>
      ) : null}
    </>
  );
}

type ProfileFootprintStepId = 'consent' | 'scan' | 'findings' | 'checklist';

interface ProfileFootprintStepInfo {
  readonly id: ProfileFootprintStepId;
  readonly label: string;
  readonly status: string;
  readonly heading: string;
  readonly description: string;
  readonly available: boolean;
}

function reviewCounts(audit: CandidateFootprintAudit | null) {
  const findings = audit?.findings ?? [];
  const unresolved = findings.filter((finding) => finding.review === 'unreviewed').length;
  return { total: findings.length, unresolved, resolved: findings.length - unresolved };
}

type ProfileFootprintStepState = Pick<
  CandidateFootprintAuditSurfaceProps,
  'consent' | 'audit' | 'ownershipConfirmed' | 'metadataCheck'
>;

const PROFILE_FOOTPRINT_STEP_META: ReadonlyArray<
  Omit<ProfileFootprintStepInfo, 'status' | 'available'>
> = [
  {
    id: 'consent',
    label: 'Согласие',
    heading: 'Согласие на цифровой след',
    description: 'Посмотрите, какие данные и источники будут использованы до начала проверки.',
  },
  {
    id: 'scan',
    label: 'Сканирование',
    heading: 'План сканирования',
    description: 'Выберите публичные запросы и проверьте состояние источников перед запуском.',
  },
  {
    id: 'findings',
    label: 'Находки',
    heading: 'Найдено — подтвердите, что это вы',
    description: 'До подтверждения находки не попадают в профиль и не используются в откликах.',
  },
  {
    id: 'checklist',
    label: 'Чек-лист',
    heading: 'Чек-лист санации',
    description:
      'Пять пунктов, чтобы публичный след работал на вас. Каждый считается по вашим данным.',
  },
];

function consentStepStatus(state: ProfileFootprintStepState) {
  if (!state.consent.approved) return 'Ожидает утверждения';
  if (state.consent.granted) {
    const given = shortDate(state.audit?.ownershipConfirmedAt);
    return given ? `дано ${given}` : 'Согласие выдано';
  }
  return 'Нужно ваше согласие';
}

function scanStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state === 'pending') return 'Проверка выполняется';
  if (state.audit?.state === 'failed') return 'Не завершена';
  if (state.audit?.state === 'completed') {
    // Mockup 2: «4 источника, 06.10» — how many sources answered and when the scan finished.
    const checked = state.audit.adapterStatuses.filter((item) => item.state === 'checked').length;
    const finished = shortDate(state.audit.completedAt);
    if (checked > 0) {
      const sources = pluralRu(checked, ['источник', 'источника', 'источников']);
      return finished ? `${sources}, ${finished}` : sources;
    }
    return finished ? `Завершена ${finished}` : 'Завершена';
  }
  return 'Не запускалась';
}

function findingsStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state !== 'completed') return 'После завершения проверки';
  const unresolved = reviewCounts(state.audit).unresolved;
  return unresolved > 0
    ? `${unresolved} ждут подтверждения`
    : `Находок: ${state.audit.findings.length}`;
}

function checklistStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state !== 'completed') return 'После проверки';
  const checklist = buildFootprintChecklist(state.audit, state.metadataCheck);
  return `${checklist.done} из ${checklist.total} пунктов`;
}

function footprintStepStatus(step: ProfileFootprintStepId, state: ProfileFootprintStepState) {
  if (step === 'consent') return consentStepStatus(state);
  if (step === 'scan') return scanStepStatus(state);
  if (step === 'findings') return findingsStepStatus(state);
  return checklistStepStatus(state);
}

function profileFootprintSteps(
  props: CandidateFootprintAuditSurfaceProps,
): ProfileFootprintStepInfo[] {
  const state: ProfileFootprintStepState = {
    consent: props.consent,
    audit: props.audit,
    ownershipConfirmed: props.ownershipConfirmed,
    metadataCheck: props.metadataCheck,
  };
  return PROFILE_FOOTPRINT_STEP_META.map((step) => ({
    ...step,
    status: footprintStepStatus(step.id, state),
    available:
      step.id === 'consent'
        ? true
        : step.id === 'scan'
          ? canOpenProfileFootprintStep(step.id, state)
          : state.audit?.state === 'completed',
  }));
}

function initialProfileFootprintStep(state: ProfileFootprintStepState): ProfileFootprintStepId {
  const audit = state.audit;
  if (audit?.state === 'completed') {
    const needsReview = audit.findings.some(
      (finding) => finding.review === 'unreviewed' || finding.review === 'hidden',
    );
    return needsReview ? 'findings' : 'checklist';
  }
  if (audit) return 'scan';
  return state.consent.granted ? 'scan' : 'consent';
}

function canOpenProfileFootprintStep(
  step: ProfileFootprintStepId,
  state: ProfileFootprintStepState,
): boolean {
  if (step === 'consent') return true;
  if (step === 'scan') {
    return Boolean(
      state.audit || (state.consent.approved && state.consent.granted && state.ownershipConfirmed),
    );
  }
  return state.audit?.state === 'completed';
}

function ConsentStepContent(props: CandidateFootprintAuditSurfaceProps) {
  return (
    <div className="profile-footprint-consent-content">
      <ConsentItemsList className="profile-footprint-consent-items" />
      <ConsentDisclosure
        approved={props.consent.approved}
        granted={props.consent.granted}
        ownershipConfirmed={props.ownershipConfirmed}
        grantingConsent={props.grantingConsent}
        revokingConsent={props.revokingConsent}
        onConfirmOwnership={props.onConfirmOwnership}
        onGrantConsent={props.onGrantConsent}
        onRevokeConsent={props.onRevokeConsent}
      />
      {props.consent.approved && props.consent.granted ? (
        <OwnershipConfirmation
          ownershipConfirmed={Boolean(props.ownershipConfirmed)}
          disabled={Boolean(props.audit?.state === 'pending' || props.starting)}
          onConfirm={props.onConfirmOwnership}
        />
      ) : null}
    </div>
  );
}

function FootprintAuditDelete(props: CandidateFootprintAuditSurfaceProps) {
  if (!props.audit) return null;
  return (
    <DeleteConfirmation
      confirmingDelete={props.confirmingDelete}
      deleting={props.deleting}
      onRequestDelete={props.onRequestDelete}
      onCancelDelete={props.onCancelDelete}
      onConfirmDelete={props.onConfirmDelete}
    />
  );
}

const PRIVACY_NOTE =
  'Находки видите только вы. До подтверждения они не попадают в профиль и отклики.';

/**
 * Mockup 2: 1440 shows the tag «Видите только вы» beside the findings heading, 390 the full
 * note above the list. Either opens consent and data controls (revoke, delete).
 */
function FootprintPrivacyToggle({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="profile-footprint-privacy-trigger"
      aria-label={PRIVACY_NOTE}
      aria-expanded={open}
      aria-controls="profile-footprint-privacy-controls"
      onClick={onToggle}
    >
      <LockSimple aria-hidden="true" />
      <span className="profile-footprint-privacy-short">Видите только вы</span>
      <span className="profile-footprint-privacy-long">{PRIVACY_NOTE}</span>
    </button>
  );
}

function ProfileFootprintStepContent({
  step,
  props,
  onOpenFindings,
}: {
  readonly step: ProfileFootprintStepId;
  readonly props: CandidateFootprintAuditSurfaceProps;
  readonly onOpenFindings: () => void;
}) {
  if (step === 'consent') return <ConsentStepContent {...props} />;
  if (step === 'scan') return <FootprintPlanControls {...props} />;
  if (step === 'findings') {
    return (
      <FindingsSection
        audit={props.audit}
        busyFindingId={props.busyFindingId}
        onReview={props.onReview}
      />
    );
  }
  return (
    <FootprintSanitationChecklist
      audit={props.audit}
      metadataCheck={props.metadataCheck}
      busyFindingId={props.busyFindingId}
      onOpenFindings={onOpenFindings}
      onMarkFinding={props.onMarkFinding}
      onAddToProfile={props.onAddToProfile}
      onOpenResumeVersions={props.onOpenResumeVersions}
    />
  );
}

function FootprintPrivacyControls({
  props,
  onClose,
}: {
  readonly props: CandidateFootprintAuditSurfaceProps;
  readonly onClose: () => void;
}) {
  return (
    <FootprintPrivacyDialog onClose={onClose}>
      <ConsentStepContent {...props} />
      <FootprintAuditDelete {...props} />
    </FootprintPrivacyDialog>
  );
}

function useProfileFootprintStep(props: CandidateFootprintAuditSurfaceProps) {
  const { audit, consent, ownershipConfirmed, loading } = props;
  const initialState: ProfileFootprintStepState = { audit, consent, ownershipConfirmed };
  const [activeStep, setActiveStepState] = useState<ProfileFootprintStepId>(() =>
    initialProfileFootprintStep(initialState),
  );
  const userSelectedStep = useRef(false);
  const initialLoadPending = useRef(Boolean(loading));

  const selectStep = (step: ProfileFootprintStepId) => {
    userSelectedStep.current = true;
    setActiveStepState(step);
  };

  useEffect(() => {
    const state: ProfileFootprintStepState = { audit, consent, ownershipConfirmed };
    const suggestedStep = initialProfileFootprintStep(state);
    if (initialLoadPending.current) {
      if (loading) return;
      initialLoadPending.current = false;
      setActiveStepState((current) =>
        userSelectedStep.current && canOpenProfileFootprintStep(current, state)
          ? current
          : suggestedStep,
      );
      return;
    }
    setActiveStepState((current) =>
      canOpenProfileFootprintStep(current, state) ? current : suggestedStep,
    );
  }, [audit, consent, loading, ownershipConfirmed]);

  return { activeStep, setActiveStep: selectStep };
}

function ProfileFootprintStepNavigation({
  steps,
  activeStep,
  onSelect,
}: {
  readonly steps: readonly ProfileFootprintStepInfo[];
  readonly activeStep: ProfileFootprintStepId;
  readonly onSelect: (step: ProfileFootprintStepId) => void;
}) {
  return (
    <nav className="profile-footprint-step-nav" aria-label="Шаги цифрового следа">
      <ol className="profile-footprint-steps">
        {steps.map((step, index) => {
          const current = activeStep === step.id;
          return (
            <li key={step.id}>
              <button
                type="button"
                className="career-footprint-secondary-button profile-footprint-step"
                aria-current={current ? 'step' : undefined}
                aria-controls="profile-footprint-step-panel"
                disabled={!step.available}
                onClick={() => onSelect(step.id)}
              >
                <strong>
                  {index + 1} {step.label}
                </strong>
                <span>{step.status}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ProfileFootprintStepHeader({
  step,
  privacyControlsOpen,
  onTogglePrivacyControls,
}: {
  readonly step: ProfileFootprintStepInfo;
  readonly privacyControlsOpen: boolean;
  readonly onTogglePrivacyControls: () => void;
}) {
  return (
    <header className="profile-footprint-step-panel-header">
      <h3 id="profile-footprint-step-title">{step.heading}</h3>
      <p>{step.description}</p>
      {step.id === 'findings' || step.id === 'checklist' ? (
        <FootprintPrivacyToggle open={privacyControlsOpen} onToggle={onTogglePrivacyControls} />
      ) : null}
    </header>
  );
}

export function CandidateFootprintAuditSurface(props: CandidateFootprintAuditSurfaceProps) {
  const { activeStep, setActiveStep } = useProfileFootprintStep(props);
  const [privacyControlsOpen, setPrivacyControlsOpen] = useState(false);
  const steps = profileFootprintSteps(props);
  const active = steps.find((step) => step.id === activeStep) ?? steps[0]!;
  const busy = Boolean(props.loading || props.starting || props.audit?.state === 'pending');

  useEffect(() => {
    if (activeStep !== 'findings' && activeStep !== 'checklist') setPrivacyControlsOpen(false);
  }, [activeStep]);

  const findingsClass =
    activeStep === 'findings' && props.audit?.state === 'completed'
      ? ' career-footprint-surface--findings'
      : '';

  return (
    <div
      className={`career-footprint-surface${findingsClass}`}
      role="region"
      aria-label="Цифровой след"
    >
      <FootprintSurfaceFeedback error={props.error} notice={props.notice} onRetry={props.onRetry} />
      <FootprintAuditFeedback {...props} />
      <ProfileFootprintStepNavigation
        steps={steps}
        activeStep={activeStep}
        onSelect={setActiveStep}
      />
      <section
        id="profile-footprint-step-panel"
        className={`profile-footprint-step-panel profile-footprint-step-panel--${activeStep}`}
        aria-labelledby="profile-footprint-step-title"
        aria-busy={busy || undefined}
        data-testid="profile-footprint-active-step"
      >
        <ProfileFootprintStepHeader
          step={active}
          privacyControlsOpen={privacyControlsOpen}
          onTogglePrivacyControls={() => setPrivacyControlsOpen((open) => !open)}
        />
        <ProfileFootprintStepContent
          step={activeStep}
          props={props}
          onOpenFindings={() => setActiveStep('findings')}
        />
      </section>
      {privacyControlsOpen ? (
        <FootprintPrivacyControls props={props} onClose={() => setPrivacyControlsOpen(false)} />
      ) : null}
    </div>
  );
}
