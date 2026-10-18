import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  EyeSlash,
  Info,
  LockSimple,
  ShieldCheck,
  TrashSimple,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
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
  sherlock: 'Публичные профили Sherlock',
  maigret: 'Публичные профили Maigret',
  hibp: 'Утечки почты HIBP',
  wayback: 'Архивные страницы Wayback',
  exa: 'Поиск в открытом вебе Exa',
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
      <p>Скоро: ждёт утверждения текста согласия.</p>
    </div>
  );
}

function GrantedConsent({
  revokingConsent,
  onRevokeConsent,
}: Pick<ConsentDisclosureProps, 'revokingConsent' | 'onRevokeConsent'>): JSX.Element {
  return (
    <section className="career-footprint-consent" aria-label="Согласие на цифровой след">
      <p role="status">
        Согласие выдано. Отзыв остановит текущую проверку и удалит сохранённые находки.
      </p>
      <button
        type="button"
        className="career-footprint-secondary-button"
        disabled={revokingConsent}
        aria-busy={revokingConsent}
        onClick={onRevokeConsent}
      >
        {revokingConsent ? 'Отзываем согласие' : 'Отозвать согласие'}
      </button>
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

function FindingGroupTitle(kind: string): string {
  if (kind === 'profile') return 'Профили';
  if (kind === 'breach') return 'Утечки';
  if (kind === 'archive') return 'Архивные страницы';
  if (kind === 'mention') return 'Упоминания';
  return 'Другие находки';
}

function findingLabel(finding: CandidateFootprintFinding): string {
  if (finding.review === 'confirmed_self') return 'Подтверждено вами';
  if (finding.review === 'not_self') return 'Вы отметили «не я»';
  if (finding.match === 'likely_self') return 'Нужно проверить';
  return 'Совпадение не подтверждено';
}

function observedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
        Не я
      </button>
    </div>
  );
}

function FindingReviewButtons({
  finding,
  busy,
  onReview,
}: {
  readonly finding: CandidateFootprintFinding;
  readonly busy: boolean;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
}) {
  if (finding.review === 'hidden') {
    return (
      <button type="button" disabled={busy} onClick={() => onReview(finding.id, 'unreviewed')}>
        Показать
      </button>
    );
  }
  return (
    <div className="career-footprint-review-actions profile-footprint-review-actions--segmented">
      <ProfileFootprintReviewSegments finding={finding} busy={busy} onReview={onReview} />
      <button
        type="button"
        className="profile-footprint-review-hide"
        disabled={busy}
        onClick={() => onReview(finding.id, 'hidden')}
      >
        Скрыть
      </button>
    </div>
  );
}

function ProfileFootprintFindingEvidence({
  finding,
}: {
  readonly finding: CandidateFootprintFinding;
}) {
  return (
    <>
      <div className="profile-footprint-finding-evidence-desktop">
        <p className="career-footprint-finding-sources">Источники: {finding.sources.join(', ')}</p>
        {finding.url ? (
          <a href={finding.url} target="_blank" rel="noopener noreferrer">
            Открыть источник
          </a>
        ) : null}
      </div>
      <details className="profile-footprint-finding-evidence-mobile">
        <summary>Источники и дата</summary>
        <div>
          <span className="career-footprint-finding-date">{observedDate(finding.observedAt)}</span>
          <p className="career-footprint-finding-sources">
            Источники: {finding.sources.join(', ')}
          </p>
          {finding.url ? (
            <a href={finding.url} target="_blank" rel="noopener noreferrer">
              Открыть источник
            </a>
          ) : null}
        </div>
      </details>
    </>
  );
}

function FindingCard({
  finding,
  busy,
  onReview,
}: {
  readonly finding: CandidateFootprintFinding;
  readonly busy: boolean;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
}) {
  const SourceIcon =
    finding.review === 'confirmed_self'
      ? CheckCircle
      : finding.review === 'not_self'
        ? XCircle
        : finding.review === 'hidden'
          ? EyeSlash
          : Info;
  return (
    <li className="career-footprint-finding">
      <div className="career-footprint-finding-heading">
        <div>
          <strong>{finding.title}</strong>
          <span className="career-footprint-finding-status">
            <SourceIcon aria-hidden="true" />
            {findingLabel(finding)}
          </span>
        </div>
        <span className="career-footprint-finding-date">{observedDate(finding.observedAt)}</span>
      </div>
      <p className="career-footprint-finding-detail">{finding.detail}</p>
      <ProfileFootprintFindingEvidence finding={finding} />
      <FindingReviewButtons finding={finding} busy={busy} onReview={onReview} />
    </li>
  );
}

function FindingsSection({
  audit,
  busyFindingId,
  onReview,
}: Pick<CandidateFootprintAuditSurfaceProps, 'audit' | 'busyFindingId' | 'onReview'>) {
  const findings = audit?.findings ?? [];
  const visible = findings.filter((finding) => finding.review !== 'hidden');
  const hidden = findings.filter((finding) => finding.review === 'hidden');
  const groups = [...new Set(visible.map((finding) => finding.kind))];
  if (!audit || audit.state === 'pending') return null;
  return (
    <section className="career-footprint-findings" aria-labelledby="footprint-findings-title">
      <h3 id="footprint-findings-title">Находки</h3>
      {groups.length ? (
        groups.map((kind) => (
          <FindingGroup
            key={kind}
            kind={kind}
            findings={visible.filter((finding) => finding.kind === kind)}
            busyFindingId={busyFindingId}
            onReview={onReview}
          />
        ))
      ) : (
        <div className="career-footprint-empty-results" role="status">
          <ShieldCheck aria-hidden="true" />
          <p>По выбранным источникам новых находок нет.</p>
        </div>
      )}
      {hidden.length ? (
        <details className="career-footprint-hidden">
          <summary>Скрытые находки ({hidden.length})</summary>
          <ul>
            {hidden.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                busy={busyFindingId === finding.id}
                onReview={onReview}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function FindingGroup({
  kind,
  findings,
  busyFindingId,
  onReview,
}: {
  readonly kind: string;
  readonly findings: readonly CandidateFootprintFinding[];
  readonly busyFindingId?: string;
  readonly onReview: (findingId: string, review: FootprintReview) => void;
}) {
  return (
    <section aria-label={FindingGroupTitle(kind)} className="career-footprint-finding-group">
      <h4>{FindingGroupTitle(kind)}</h4>
      <ul>
        {findings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            busy={busyFindingId === finding.id}
            onReview={onReview}
          />
        ))}
      </ul>
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
      ? 'Скоро: ждёт утверждения текста согласия'
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
        Exa получает выбранные имя, компании и город; ссылка на фото профиля остаётся только для
        локального сопоставления с URL изображения в ответе Exa. HIBP получает только 6 символов
        SHA-1-отпечатка почты; сам адрес и пароль не отправляются. Wayback получает выбранную
        ссылку. Sherlock и Maigret проверяют выбранные страницы только запросом GET, без входа в
        аккаунты.
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
  'consent' | 'audit' | 'ownershipConfirmed'
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
    heading: 'Решения по находкам',
    description: 'Здесь показаны только находки и решения, сохранённые в этой проверке.',
  },
];

function consentStepStatus(state: ProfileFootprintStepState) {
  if (!state.consent.approved) return 'Ожидает утверждения';
  if (state.consent.granted) return 'Согласие выдано';
  return 'Нужно ваше согласие';
}

function scanStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state === 'pending') return 'Проверка выполняется';
  if (state.audit?.state === 'failed') return 'Не завершена';
  if (state.audit?.state === 'completed') {
    return state.audit.completedAt
      ? `Завершена ${observedDate(state.audit.completedAt)}`
      : 'Завершена';
  }
  return 'Не запускалась';
}

function findingsStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state !== 'completed') return 'После завершения проверки';
  const unresolved = reviewCounts(state.audit).unresolved;
  return unresolved > 0
    ? `Нужно проверить: ${unresolved}`
    : `Находок: ${state.audit.findings.length}`;
}

function checklistStepStatus(state: ProfileFootprintStepState) {
  if (state.audit?.state !== 'completed') return 'После решений по находкам';
  const counts = reviewCounts(state.audit);
  return counts.total === 0 ? 'Нет находок' : `${counts.resolved} из ${counts.total} решений`;
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

function checklistReviewLabel(review: FootprintReview): string {
  if (review === 'confirmed_self') return 'Подтверждено как ваше';
  if (review === 'not_self') return 'Отмечено как не ваше';
  if (review === 'hidden') return 'Скрыто';
  return 'Нужно проверить';
}

function ReviewChecklistItem({
  finding,
  onOpenFindings,
}: {
  readonly finding: CandidateFootprintFinding;
  readonly onOpenFindings: () => void;
}) {
  const needsAction = finding.review === 'unreviewed' || finding.review === 'hidden';
  return (
    <li className="profile-footprint-checklist-item" key={finding.id}>
      <div className="profile-footprint-checklist-copy">
        <strong>{finding.title}</strong>
        <span>{checklistReviewLabel(finding.review)}</span>
        <small>Источники: {finding.sources.join(', ')}</small>
      </div>
      {needsAction ? (
        <button
          type="button"
          className="career-footprint-secondary-button profile-footprint-checklist-action"
          onClick={onOpenFindings}
        >
          Проверить находку
        </button>
      ) : null}
    </li>
  );
}

function ReviewChecklist({
  audit,
  onOpenFindings,
}: {
  readonly audit: CandidateFootprintAudit | null;
  readonly onOpenFindings: () => void;
}) {
  if (!audit || audit.state !== 'completed') return null;
  const counts = reviewCounts(audit);
  if (audit.findings.length === 0) {
    return (
      <div className="career-footprint-empty-results" role="status">
        <ShieldCheck aria-hidden="true" />
        <p>Проверка завершена. Находок для решения нет.</p>
      </div>
    );
  }
  return (
    <section
      className="profile-footprint-checklist"
      aria-labelledby="profile-footprint-checklist-title"
    >
      <div className="profile-footprint-checklist-heading">
        <h4 id="profile-footprint-checklist-title">Проверенные находки</h4>
        <span className="career-footprint-count">
          {counts.resolved} из {counts.total} решений
        </span>
      </div>
      <ul className="profile-footprint-checklist-list">
        {audit.findings.map((finding) => (
          <ReviewChecklistItem key={finding.id} finding={finding} onOpenFindings={onOpenFindings} />
        ))}
      </ul>
    </section>
  );
}

function ProfileFootprintFindingsStep({
  props,
  privacyControlsOpen,
  onTogglePrivacyControls,
}: {
  readonly props: CandidateFootprintAuditSurfaceProps;
  readonly privacyControlsOpen: boolean;
  readonly onTogglePrivacyControls: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="profile-footprint-privacy-trigger"
        aria-expanded={privacyControlsOpen}
        aria-controls="profile-footprint-privacy-controls"
        onClick={onTogglePrivacyControls}
      >
        <LockSimple aria-hidden="true" />
        <span>Находки видите только вы. До подтверждения они не попадают в профиль и отклики.</span>
      </button>
      {privacyControlsOpen ? (
        <section
          id="profile-footprint-privacy-controls"
          className="profile-footprint-privacy-controls"
          aria-label="Управление согласием и данными"
        >
          <ConsentStepContent {...props} />
          <FootprintAuditDelete {...props} />
        </section>
      ) : null}
      <FindingsSection
        audit={props.audit}
        busyFindingId={props.busyFindingId}
        onReview={props.onReview}
      />
    </>
  );
}

function ProfileFootprintStepContent({
  step,
  props,
  onOpenFindings,
  privacyControlsOpen,
  onTogglePrivacyControls,
}: {
  readonly step: ProfileFootprintStepId;
  readonly props: CandidateFootprintAuditSurfaceProps;
  readonly onOpenFindings: () => void;
  readonly privacyControlsOpen: boolean;
  readonly onTogglePrivacyControls: () => void;
}) {
  if (step === 'consent') return <ConsentStepContent {...props} />;
  if (step === 'scan') {
    return (
      <>
        <FootprintPlanControls {...props} />
        <FootprintAuditDelete {...props} />
      </>
    );
  }
  if (step === 'findings') {
    return (
      <ProfileFootprintFindingsStep
        props={props}
        privacyControlsOpen={privacyControlsOpen}
        onTogglePrivacyControls={onTogglePrivacyControls}
      />
    );
  }
  return (
    <>
      <ReviewChecklist audit={props.audit} onOpenFindings={onOpenFindings} />
      <FootprintAuditDelete {...props} />
    </>
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

export function CandidateFootprintAuditSurface(props: CandidateFootprintAuditSurfaceProps) {
  const { activeStep, setActiveStep } = useProfileFootprintStep(props);
  const [privacyControlsOpen, setPrivacyControlsOpen] = useState(false);
  const steps = profileFootprintSteps(props);
  const active = steps.find((step) => step.id === activeStep) ?? steps[0]!;
  const busy = Boolean(props.loading || props.starting || props.audit?.state === 'pending');

  useEffect(() => {
    if (activeStep !== 'findings') setPrivacyControlsOpen(false);
  }, [activeStep]);

  const privacyOpenClass = privacyControlsOpen ? ' career-footprint-surface--privacy-open' : '';
  const findingsClass =
    activeStep === 'findings' && props.audit?.state === 'completed'
      ? ' career-footprint-surface--findings'
      : '';

  return (
    <div
      className={`career-footprint-surface${findingsClass}${privacyOpenClass}`}
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
        <header className="profile-footprint-step-panel-header">
          <h3 id="profile-footprint-step-title">{active.heading}</h3>
          <p>{active.description}</p>
        </header>
        <ProfileFootprintStepContent
          step={activeStep}
          props={props}
          onOpenFindings={() => setActiveStep('findings')}
          privacyControlsOpen={privacyControlsOpen}
          onTogglePrivacyControls={() => setPrivacyControlsOpen((open) => !open)}
        />
      </section>
    </div>
  );
}
