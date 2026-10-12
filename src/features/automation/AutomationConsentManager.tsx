import { X } from '@phosphor-icons/react';
import type { CandidateAutomationConsent } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import { useEscapeLayer } from '../shell/escapeLayers';
import { automationDateLabel } from './automationFormat';

const LABELS: Readonly<Record<CandidateAutomationConsent['key'], string>> = {
  drafts: 'Готовить черновики откликов и писем',
  send_after_approval: 'Отправлять после отдельного одобрения',
  notifications: 'Показывать очередь и журнал в уведомлениях',
  automatic_submission: 'Отправлять без отдельного одобрения',
};

export interface AutomationConsentManagerProps {
  readonly consents: readonly CandidateAutomationConsent[];
  readonly busyKey: string;
  readonly onClose: () => void;
  readonly onRevoke: (key: CandidateAutomationConsent['key']) => void;
}

export function AutomationConsentManager({
  consents,
  busyKey,
  onClose,
  onRevoke,
}: AutomationConsentManagerProps) {
  useEscapeLayer(onClose, !busyKey);
  return (
    <div className="automation-dialog-backdrop">
      <section
        className="automation-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-consent-manager-title"
      >
        <ConsentManagerHeader onClose={onClose} />
        <ConsentStatusList consents={consents} busyKey={busyKey} onRevoke={onRevoke} />
        <LinkedInManualNote />
        <ConsentManagerFooter onClose={onClose} />
      </section>
    </div>
  );
}

function ConsentManagerHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <header>
      <div>
        <h2 id="automation-consent-manager-title">Согласия и режим</h2>
        <p>Согласия привязаны к аккаунту и сохраняются с датой.</p>
      </div>
      <button
        className="automation-icon-button"
        type="button"
        aria-label="Закрыть согласия"
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

function ConsentStatusList({
  consents,
  busyKey,
  onRevoke,
}: {
  readonly consents: readonly CandidateAutomationConsent[];
  readonly busyKey: string;
  readonly onRevoke: AutomationConsentManagerProps['onRevoke'];
}) {
  return (
    <ul className="automation-consent-status-list">
      {consents.map((consent) => (
        <li key={consent.key}>
          <div>
            <strong>{LABELS[consent.key]}</strong>
            <small>
              {consent.revokedAt
                ? `Отозвано ${automationDateLabel(consent.revokedAt)}`
                : `Действует с ${automationDateLabel(consent.acceptedAt)}`}
            </small>
          </div>
          {!consent.revokedAt ? (
            <button
              className="career-btn career-btn-secondary"
              type="button"
              disabled={busyKey === consent.key}
              onClick={() => onRevoke(consent.key)}
            >
              {busyKey === consent.key ? 'Отзываем…' : 'Отозвать'}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LinkedInManualNote() {
  return (
    <div className="automation-info-note">
      <strong>LinkedIn</strong>
      <span>
        Публикация без вашего участия выключена правилом. Одобрение черновика и сама публикация
        остаются за вами.
      </span>
    </div>
  );
}

function ConsentManagerFooter({ onClose }: { readonly onClose: () => void }) {
  return (
    <footer>
      <button className="career-btn career-btn-secondary" type="button" onClick={onClose}>
        Готово
      </button>
    </footer>
  );
}
