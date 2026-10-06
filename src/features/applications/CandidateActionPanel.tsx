import { CheckCircle, PaperPlaneTilt, StopCircle, WarningCircle } from '@phosphor-icons/react';
import {
  CAPABILITY_CONSENT_DOCUMENTS,
} from '../legal/capabilityConsents';
import type { CandidateActionReceiptView } from './applicationsApi';
import {
  actionFailureLabel,
  actionStatusLabel,
  formatActionCount,
  formatActionReset,
} from './candidateActionModel';
import { useCandidateActionPanel } from './useCandidateActionPanel';
import './candidate-action.css';

export function CandidateActionPanel({
  applications,
  onRefreshApplications,
}: {
  readonly applications: Parameters<typeof useCandidateActionPanel>[0];
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}) {
  const panel = useCandidateActionPanel(applications, onRefreshApplications);
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
      {panel.busy ? <BatchProgress receipts={panel.liveReceipts} total={panel.selectedCount} /> : null}
      <ReceiptHistory receipts={panel.receipts} />
    </section>
  );
}

function PanelHeader({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  return (
    <header className="career-candidate-actions__header">
      <div>
        <h2 id="career-candidate-actions-title">Отправка откликов</h2>
        <p className="career-candidate-actions__intro">Выберите вакансии и проверьте ссылки и письма.</p>
        <p className="career-candidate-actions__intro">Отправка начнётся после вашего подтверждения.</p>
      </div>
      {panel.usage ? (
        <button
          type="button"
          className={`career-btn career-candidate-actions__kill-switch${panel.usage.killSwitchActive ? ' is-active' : ''}`}
          onClick={() => void panel.toggleKillSwitch()}
          disabled={panel.loading || panel.consentBusy}
          aria-pressed={panel.usage.killSwitchActive}
        >
          <StopCircle />
          {panel.usage.killSwitchActive ? 'Снять остановку' : 'Остановить всё'}
        </button>
      ) : null}
    </header>
  );
}

function ConsentPanel({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  const document = CAPABILITY_CONSENT_DOCUMENTS.actions_on_behalf;
  return (
    <section className="career-candidate-actions__consent" aria-labelledby="candidate-action-consent-title">
      <div>
        <h3 id="candidate-action-consent-title">Согласие на действия от вашего имени</h3>
        <p>{document.title}. Прочитайте условия перед принятием.</p>
      </div>
      <ul>
        {document.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <label className="career-candidate-actions__check">
        <input
          type="checkbox"
          checked={panel.consentAccepted}
          onChange={(event) => panel.setConsentAccepted(event.currentTarget.checked)}
        />
        <span>Я прочитал условия и согласен на действия, которые подтвержу отдельно.</span>
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

function ActionComposer({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  if (panel.loading || !panel.usage) return <p className="career-candidate-actions__muted">Загружаем лимиты и квитанции.</p>;
  return (
    <>
      <ActionUsage panel={panel} />
      {panel.runnerNotConnected ? (
        <Notice message="Исполнитель действий не подключён к сессии на этом устройстве. Действия не запускались." />
      ) : null}
      <ActionSelectionList panel={panel} />
      <ResumeBoostOption panel={panel} />
      {panel.limitMessage ? <Notice message={panel.limitMessage} limit /> : null}
      {panel.letterMissing ? (
        <Notice message="Для каждого отклика на hh.ru добавьте письмо и проверьте его перед отправкой." limit />
      ) : null}
      <ActionConfirmation panel={panel} />
    </>
  );
}

function ActionUsage({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  const { usage, timezone, resetAt } = panel.usage!;
  return (
    <div className="career-candidate-actions__usage" aria-label="Суточные лимиты действий">
      <span>hh.ru: {usage.hhAppliesCount}/{panel.usage!.limits.maxHhAppliesPerDay}</span>
      <span>LinkedIn: {usage.linkedinEasyAppliesCount}/{panel.usage!.limits.maxLinkedinEasyAppliesPerDay}</span>
      <span>Поднятие резюме: {usage.hhBoostsCount}/{panel.usage!.limits.maxHhBoostsPerDay}</span>
      <span>Сброс лимитов: {formatActionReset(resetAt, timezone)}</span>
    </div>
  );
}

function ActionSelectionList({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  if (panel.selectableApplications.length === 0) {
    return (
      <div className="career-candidate-actions__notice">
        <p>
          Нет сохранённых вакансий с поддерживаемыми ссылками на hh.ru или LinkedIn. Добавьте вакансию в «Отклики», чтобы подготовить действие.
        </p>
      </div>
    );
  }
  return (
    <fieldset className="career-candidate-actions__fieldset">
      <legend className="career-candidate-actions__muted">Вакансии на этапе «Хочу»</legend>
      <ul className="career-candidate-actions__list">
        {panel.selectableApplications.map((item) => (
          <ActionSelectionItem
            key={item.application.id}
            item={item}
            selected={panel.selectedIds.has(item.application.id)}
            letter={panel.letters.get(item.application.id) ?? ''}
            onSelect={(selected) => panel.toggleApplication(item.application.id, selected)}
            onLetter={(value) => panel.setLetter(item.application.id, value)}
          />
        ))}
      </ul>
    </fieldset>
  );
}

function ActionSelectionItem({
  item,
  selected,
  letter,
  onSelect,
  onLetter,
}: {
  readonly item: ReturnType<typeof useCandidateActionPanel>['selectableApplications'][number];
  readonly selected: boolean;
  readonly letter: string;
  readonly onSelect: (selected: boolean) => void;
  readonly onLetter: (value: string) => void;
}) {
  const application = item.application;
  const title = application.vacancy?.title ?? 'Вакансия без названия';
  const company = application.vacancy?.companyHidden ? 'Компания скрыта' : application.vacancy?.company || 'Компания не указана';
  const checkboxId = `candidate-action-${application.id}`;
  return (
    <li className="career-candidate-actions__item">
      <div className="career-candidate-actions__select">
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.currentTarget.checked)}
        />
        <label className="career-candidate-actions__details" htmlFor={checkboxId}>
          <strong>{title} · {company}</strong>
          <span>{item.platform === 'hh' ? 'Отклик на hh.ru' : 'Easy Apply в LinkedIn'}</span>
          <span className="career-candidate-actions__url">{item.targetUrl}</span>
        </label>
      </div>
      {selected ? (
        <label className="career-candidate-actions__letter">
          Текст письма или заметки для площадки
          <textarea value={letter} onChange={(event) => onLetter(event.currentTarget.value)} maxLength={5_000} />
        </label>
      ) : null}
    </li>
  );
}

function ResumeBoostOption({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  return (
    <label className="career-candidate-actions__check career-candidate-actions__item">
      <input
        type="checkbox"
        checked={panel.includeResumeBoost}
        onChange={(event) => panel.setIncludeResumeBoost(event.currentTarget.checked)}
      />
      <span>
        Поднять резюме на hh.ru, если в сессии доступно ровно одно резюме. Если резюме несколько, действие остановится без выбора.
      </span>
    </label>
  );
}

function ActionConfirmation({ panel }: { panel: ReturnType<typeof useCandidateActionPanel> }) {
  const canSubmit = panel.selectedCount > 0 && !panel.loading && !panel.busy && panel.consentGranted &&
    panel.confirmedByCandidate && !panel.usage?.killSwitchActive && !panel.limitMessage && !panel.letterMissing;
  return (
    <div className="career-candidate-actions__footer">
      <label className="career-candidate-actions__check">
        <input
          type="checkbox"
          checked={panel.confirmedByCandidate}
          onChange={(event) => panel.setConfirmedByCandidate(event.currentTarget.checked)}
          disabled={panel.selectedCount === 0 || panel.busy}
        />
        <span>Я проверил письма и ссылки для каждого выбранного действия.</span>
      </label>
      <button
        type="button"
        className={`career-btn ${panel.selectedCount > 0 ? 'career-btn-primary' : 'career-btn-secondary'}`}
        onClick={() => void panel.submit()}
        disabled={!canSubmit}
        aria-busy={panel.busy}
      >
        <PaperPlaneTilt />
        {panel.busy ? 'Отправляем пакет' : `Отправить ${formatActionCount(panel.selectedCount)}`}
      </button>
    </div>
  );
}

function BatchProgress({
  receipts,
  total,
}: {
  readonly receipts: readonly CandidateActionReceiptView[];
  readonly total: number;
}) {
  const processed = receipts.filter((receipt) => receipt.status !== 'pending').length;
  return (
    <div className="career-candidate-actions__progress" role="status" aria-live="polite" aria-busy="true">
      <span>Обработано {processed} из {total}. Пакет остановится при challenge, отказе площадки или включении kill switch.</span>
      <ReceiptList receipts={receipts} />
    </div>
  );
}

function ReceiptHistory({ receipts }: { receipts: readonly CandidateActionReceiptView[] }) {
  if (receipts.length === 0) return null;
  return (
    <details className="career-candidate-actions__results" open={receipts.length > 0}>
      <summary>Последние квитанции ({receipts.length})</summary>
      <ReceiptList receipts={receipts.slice(0, 10)} />
    </details>
  );
}

function ReceiptList({ receipts }: { receipts: readonly CandidateActionReceiptView[] }) {
  return (
    <ul className="career-candidate-actions__receipt-list">
      {receipts.map((receipt) => <ReceiptItem key={receipt.id} receipt={receipt} />)}
    </ul>
  );
}

function ReceiptItem({ receipt }: { receipt: CandidateActionReceiptView }) {
  const status = receipt.status;
  return (
    <li className="career-candidate-actions__receipt">
      <strong>{receipt.platform === 'hh' ? 'hh.ru' : 'LinkedIn'} · {actionKindLabel(receipt.actionKind)}</strong>
      <span className={`career-candidate-actions__status is-${status}`}>{actionStatusLabel(status)}</span>
      {receipt.failureCode ? <span className="career-candidate-actions__reason">{actionFailureLabel(receipt.failureCode)}</span> : null}
    </li>
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
  ].filter(Boolean).join(' ');
  return (
    <div className={className} {...(role ? { role } : {})}>
      {role === 'alert' ? <WarningCircle aria-hidden="true" /> : null}
      <p>{message}</p>
    </div>
  );
}

function actionKindLabel(kind: CandidateActionReceiptView['actionKind']): string {
  if (kind === 'hh_apply') return 'Отклик';
  if (kind === 'hh_resume_boost') return 'Поднятие резюме';
  return 'Easy Apply';
}
