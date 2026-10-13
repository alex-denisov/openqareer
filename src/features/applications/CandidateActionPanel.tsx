import {
  CheckCircle,
  Clock,
  PaperPlaneTilt,
  StopCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import { CAPABILITY_CONSENT_DOCUMENTS } from '../legal/capabilityConsents';
import type { ApplicationView, CandidateActionReceiptView } from './applicationsApi';
import { CandidateActionTable } from './CandidateActionTable';
import { ReceiptTable } from './CandidateActionReceipts';
import { formatActionCount, formatActionReset } from './candidateActionModel';
import { useCandidateActionPanel } from './useCandidateActionPanel';
import './candidate-action.css';

type Panel = ReturnType<typeof useCandidateActionPanel>;

export function CandidateActionPanel({
  applications,
  onRefreshApplications,
}: {
  readonly applications: readonly ApplicationView[];
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}) {
  const panel = useCandidateActionPanel(applications, onRefreshApplications);
  const byId = useMemo(() => new Map(applications.map((item) => [item.id, item])), [applications]);
  return (
    <section
      className="career-candidate-actions"
      aria-labelledby="career-candidate-actions-title"
      aria-busy={panel.loading || panel.busy}
    >
      <PanelHeader panel={panel} />
      {panel.loadError ? <Notice role="alert" message={panel.loadError} /> : null}
      {panel.actionError ? <Notice role="alert" message={panel.actionError} /> : null}
      {panel.notice ? <Notice message={panel.notice} success /> : null}
      {!panel.consentGranted ? <ConsentPanel panel={panel} /> : <ActionComposer panel={panel} />}
      {panel.busy ? (
        <BatchProgress receipts={panel.liveReceipts} total={panel.selectedCount} byId={byId} />
      ) : null}
      <ReceiptHistory receipts={panel.receipts} byId={byId} />
    </section>
  );
}

function PanelHeader({ panel }: { panel: Panel }) {
  return (
    <header className="career-candidate-actions__header">
      <div className="career-candidate-actions__title-row">
        <h2 id="career-candidate-actions-title">Ручная отправка</h2>
        {panel.consentGranted ? (
          <span className="career-pill is-good">
            <CheckCircle aria-hidden="true" />
            Согласие дано
          </span>
        ) : null}
      </div>
      {panel.usage ? (
        <button
          type="button"
          className={`career-btn career-btn-secondary career-btn-sm career-candidate-actions__kill-switch${panel.usage.killSwitchActive ? ' is-active' : ''}`}
          onClick={() => void panel.toggleKillSwitch()}
          disabled={panel.loading || panel.consentBusy}
          aria-pressed={panel.usage.killSwitchActive}
        >
          <StopCircle aria-hidden="true" />
          {panel.usage.killSwitchActive ? 'Снять остановку' : 'Остановить всё'}
        </button>
      ) : null}
      <p className="career-candidate-actions__intro">
        Для вакансий, которые нужно отправить сегодня и не ждать расписания. Остальное идёт через
        очередь на одобрение. Письма и ссылки проверяете вы: ничего не уходит без «Отправить».
      </p>
    </header>
  );
}

function ConsentPanel({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  const document = CAPABILITY_CONSENT_DOCUMENTS.actions_on_behalf;
  return (
    <section
      className="career-candidate-actions__consent"
      aria-labelledby="candidate-action-consent-title"
    >
      <div>
        <h3 id="candidate-action-consent-title">Согласие на действия от вашего имени</h3>
        <p>{document.title}. Прочитайте условия перед принятием.</p>
      </div>
      <ul>
        {document.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <label className="career-checkbox-label career-candidate-actions__consent-check">
        <input
          type="checkbox"
          className="career-checkbox"
          checked={panel.consentAccepted}
          onChange={(event) => panel.setConsentAccepted(event.currentTarget.checked)}
        />
        <span className="career-checkbox-text">
          Я прочитал условия и согласен на действия, которые подтвержу отдельно.
        </span>
      </label>
      {panel.consentError ? <Notice role="alert" message={panel.consentError} /> : null}
      {!panel.consentCanBeGiven ? (
        <p className="career-candidate-actions__muted">
          Принятие отключено, пока формулировка согласия проходит утверждение.
        </p>
      ) : null}
      <div className="career-candidate-actions__consent-actions">
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => void panel.grantConsent()}
          disabled={!panel.consentCanBeGiven || !panel.consentAccepted || panel.consentBusy}
          aria-busy={panel.consentBusy}
        >
          <CheckCircle />
          {panel.consentBusy ? 'Сохраняем согласие' : 'Дать согласие'}
        </button>
      </div>
    </section>
  );
}

function ActionComposer({ panel }: { panel: Panel }) {
  if (panel.loading || !panel.usage)
    return <p className="career-candidate-actions__muted">Загружаем лимиты и квитанции.</p>;
  return (
    <>
      <ActionUsage panel={panel} />
      {panel.usage.killSwitchActive ? (
        <Notice message="Ручная отправка остановлена. Снимите остановку, чтобы продолжить." limit />
      ) : null}
      {panel.runnerNotConnected ? (
        <Notice message="Исполнитель действий не подключён к сессии на этом устройстве. Действия не запускались." />
      ) : null}
      <ActionSelection panel={panel} />
      {panel.limitMessage ? <Notice message={panel.limitMessage} limit /> : null}
      {panel.letterMissing ? (
        <Notice
          message="Для каждого отклика на hh.ru добавьте письмо и проверьте его перед отправкой."
          limit
        />
      ) : null}
      <ActionConfirmation panel={panel} />
    </>
  );
}

function ActionUsage({ panel }: { panel: Panel }) {
  const { usage, limits, timezone, resetAt } = panel.usage!;
  return (
    <div
      className="career-candidate-actions__usage"
      role="group"
      aria-label="Суточные лимиты действий"
    >
      <span className="career-candidate-actions__chip">
        hh.ru{' '}
        <span className="career-candidate-actions__num">
          {usage.hhAppliesCount} / {limits.maxHhAppliesPerDay}
        </span>
      </span>
      <span className="career-candidate-actions__chip">
        LinkedIn{' '}
        <span className="career-candidate-actions__num">
          {usage.linkedinEasyAppliesCount} / {limits.maxLinkedinEasyAppliesPerDay}
        </span>
      </span>
      <span className="career-candidate-actions__chip">
        Поднятие резюме{' '}
        <span className="career-candidate-actions__num">
          {usage.hhBoostsCount} / {limits.maxHhBoostsPerDay}
        </span>
      </span>
      <span className="career-candidate-actions__chip">
        <Clock aria-hidden="true" />
        Лимиты сбросятся: {formatActionReset(resetAt, timezone)}
      </span>
    </div>
  );
}

function ActionSelection({ panel }: { panel: Panel }) {
  if (panel.selectableApplications.length === 0) {
    return (
      <div className="career-candidate-actions__notice">
        <p>
          Нет сохранённых вакансий с поддерживаемыми ссылками на hh.ru или LinkedIn. Добавьте
          вакансию в «Отклики», чтобы подготовить действие.
        </p>
      </div>
    );
  }
  return (
    <CandidateActionTable
      items={panel.selectableApplications}
      selectedIds={panel.selectedIds}
      letters={panel.letters}
      disabled={panel.busy || Boolean(panel.usage?.killSwitchActive)}
      onToggle={panel.toggleApplication}
      onToggleAll={panel.toggleAllApplications}
      onLetter={panel.setLetter}
    />
  );
}

function ActionConfirmation({ panel }: { panel: Panel }) {
  const canSubmit =
    panel.selectedCount > 0 &&
    !panel.loading &&
    !panel.busy &&
    panel.consentGranted &&
    panel.confirmedByCandidate &&
    !panel.usage?.killSwitchActive &&
    !panel.limitMessage &&
    !panel.letterMissing;
  return (
    <div className="career-candidate-actions__footer">
      <p className="career-candidate-actions__bulk" role="status">
        Выбрано {panel.selectedCount} из {panel.selectableApplications.length}
        {panel.includeResumeBoost ? ', поднятие резюме включено' : ''}.
      </p>
      <label className="career-checkbox-label">
        <input
          type="checkbox"
          className="career-checkbox"
          checked={panel.confirmedByCandidate}
          onChange={(event) => panel.setConfirmedByCandidate(event.currentTarget.checked)}
          disabled={panel.selectedCount === 0 || panel.busy}
        />
        <span className="career-checkbox-text">
          Я проверил письма и ссылки для каждого выбранного действия
        </span>
      </label>
      <ActionButtons panel={panel} canSubmit={canSubmit} />
    </div>
  );
}

function ActionButtons({ panel, canSubmit }: { panel: Panel; canSubmit: boolean }) {
  return (
    <div className="career-candidate-actions__actions">
      <button
        type="button"
        className={`career-btn ${panel.selectedCount > 0 ? 'career-btn-primary' : 'career-btn-secondary'}`}
        onClick={() => void panel.submit()}
        disabled={!canSubmit}
        aria-busy={panel.busy}
      >
        <PaperPlaneTilt aria-hidden="true" />
        {panel.busy ? 'Отправляем пакет' : `Отправить ${formatActionCount(panel.selectedCount)}`}
      </button>
      <button
        type="button"
        className="career-btn"
        aria-pressed={panel.includeResumeBoost}
        onClick={() => panel.setIncludeResumeBoost(!panel.includeResumeBoost)}
        disabled={panel.busy}
        title="Работает, если в сессии hh.ru доступно ровно одно резюме"
      >
        Поднять резюме на hh.ru
      </button>
    </div>
  );
}

function BatchProgress({
  receipts,
  total,
  byId,
}: {
  readonly receipts: readonly CandidateActionReceiptView[];
  readonly total: number;
  readonly byId: ReadonlyMap<string, ApplicationView>;
}) {
  const processed = receipts.filter((receipt) => receipt.status !== 'pending').length;
  return (
    <div
      className="career-candidate-actions__progress"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span>
        Обработано {processed} из {total}. Пакет остановится при проверке безопасности, отказе
        площадки или нажатии «Остановить всё».
      </span>
      {receipts.length > 0 ? (
        <ReceiptTable receipts={receipts} applications={byId} caption="Ход отправки" />
      ) : null}
    </div>
  );
}

function ReceiptHistory({
  receipts,
  byId,
}: {
  readonly receipts: readonly CandidateActionReceiptView[];
  readonly byId: ReadonlyMap<string, ApplicationView>;
}) {
  if (receipts.length === 0) return null;
  return (
    <section
      className="career-candidate-actions__results"
      aria-labelledby="career-candidate-receipts"
    >
      <h3 id="career-candidate-receipts">Последние квитанции</h3>
      <ReceiptTable
        receipts={receipts.slice(0, 10)}
        applications={byId}
        caption="Последние квитанции"
      />
    </section>
  );
}

function Notice({
  message,
  role,
  success = false,
  limit = false,
}: {
  readonly message: string;
  readonly role?: 'alert';
  readonly success?: boolean;
  readonly limit?: boolean;
}) {
  const className = [
    'career-candidate-actions__notice',
    success ? 'is-success' : '',
    limit ? 'is-limit' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} {...(role ? { role } : {})}>
      {role === 'alert' ? <WarningCircle aria-hidden="true" /> : null}
      <p>{message}</p>
    </div>
  );
}
