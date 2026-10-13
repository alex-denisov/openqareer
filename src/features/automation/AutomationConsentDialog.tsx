import { X } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import type { CandidateAutomationMode } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import { useEscapeLayer } from '../shell/escapeLayers';

const REQUIRED_CONSENTS = [
  ['drafts', 'Готовить черновики откликов и писем'],
  ['send_after_approval', 'Отправлять отклики после моего отдельного одобрения'],
  ['notifications', 'Показывать очередь и журнал в уведомлениях'],
] as const;

export interface AutomationConsentDialogProps {
  readonly busy: boolean;
  readonly error: string;
  readonly initialMode?: CandidateAutomationMode;
  readonly initialAcceptedKeys?: readonly string[];
  readonly onClose: () => void;
  readonly onSubmit: (mode: CandidateAutomationMode, consentKeys: readonly string[]) => void;
  readonly onOpenTariffs: () => void;
}

export function AutomationConsentDialog(props: AutomationConsentDialogProps) {
  const [mode, setMode] = useState<CandidateAutomationMode>(
    props.initialMode ?? 'approval_required',
  );
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(props.initialAcceptedKeys),
  );
  const [automaticAccepted, setAutomaticAccepted] = useState(false);
  useEscapeLayer(props.onClose, !props.busy);
  const canSubmit =
    REQUIRED_CONSENTS.every(([key]) => accepted.has(key)) &&
    (mode !== 'automatic' || automaticAccepted) &&
    !props.busy;

  function toggleConsent(key: string) {
    setAccepted((current) => toggleSetValue(current, key));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    props.onSubmit(mode, consentKeysFor(mode));
  }

  return (
    <ConsentDialogLayout
      {...props}
      mode={mode}
      accepted={accepted}
      automaticAccepted={automaticAccepted}
      canSubmit={canSubmit}
      onClose={props.onClose}
      onSubmit={submit}
      onModeChange={setMode}
      onToggleConsent={toggleConsent}
      onAutomaticChange={setAutomaticAccepted}
    />
  );
}

function ConsentDialogLayout(
  props: Omit<AutomationConsentDialogProps, 'onSubmit'> & {
    readonly mode: CandidateAutomationMode;
    readonly accepted: ReadonlySet<string>;
    readonly automaticAccepted: boolean;
    readonly canSubmit: boolean;
    readonly onModeChange: (mode: CandidateAutomationMode) => void;
    readonly onToggleConsent: (key: string) => void;
    readonly onAutomaticChange: (accepted: boolean) => void;
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  },
) {
  return (
    <div className="automation-dialog-backdrop">
      <section
        className="automation-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-consent-title"
        aria-describedby="automation-consent-description"
      >
        <ConsentDialogHeader busy={props.busy} onClose={props.onClose} />
        <ConsentDialogForm {...props} />
      </section>
    </div>
  );
}

function ConsentDialogHeader({
  busy,
  onClose,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
}) {
  return (
    <header>
      <div>
        <h2 id="automation-consent-title">Согласия на автоотклики</h2>
        <p id="automation-consent-description">
          Вы выбираете режим. Без вашего одобрения отклик не отправится.
        </p>
      </div>
      <button
        type="button"
        className="automation-icon-button"
        aria-label="Закрыть согласия"
        disabled={busy}
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

function ConsentDialogForm(
  props: Omit<AutomationConsentDialogProps, 'onSubmit'> & {
    readonly mode: CandidateAutomationMode;
    readonly accepted: ReadonlySet<string>;
    readonly automaticAccepted: boolean;
    readonly canSubmit: boolean;
    readonly onModeChange: (mode: CandidateAutomationMode) => void;
    readonly onToggleConsent: (key: string) => void;
    readonly onAutomaticChange: (accepted: boolean) => void;
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  },
) {
  return (
    <form onSubmit={props.onSubmit}>
      <RequiredConsentChoices
        busy={props.busy}
        accepted={props.accepted}
        onToggle={props.onToggleConsent}
      />
      <ModeChoices busy={props.busy} mode={props.mode} onChange={props.onModeChange} />
      {props.mode === 'automatic' ? (
        <AutomaticConsent
          busy={props.busy}
          accepted={props.automaticAccepted}
          onChange={props.onAutomaticChange}
          onOpenTariffs={props.onOpenTariffs}
        />
      ) : null}
      <p className="automation-note">
        Согласия сохраняются с датой и могут быть отозваны в разделе «Согласия».
      </p>
      {props.error ? (
        <p className="automation-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <ConsentActions busy={props.busy} canSubmit={props.canSubmit} onClose={props.onClose} />
    </form>
  );
}

function RequiredConsentChoices({
  busy,
  accepted,
  onToggle,
}: {
  readonly busy: boolean;
  readonly accepted: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}) {
  return (
    <fieldset className="automation-consent-list" disabled={busy}>
      <legend>Обязательные согласия</legend>
      {REQUIRED_CONSENTS.map(([key, label]) => (
        <label className="automation-consent-row" htmlFor={`automation-consent-${key}`} key={key}>
          <input
            id={`automation-consent-${key}`}
            type="checkbox"
            checked={accepted.has(key)}
            onChange={() => onToggle(key)}
          />
          <span>{label}</span>
        </label>
      ))}
      <label
        className="automation-consent-row is-disabled"
        htmlFor="automation-consent-linkedin-publish"
      >
        <input
          id="automation-consent-linkedin-publish"
          type="checkbox"
          aria-label="Публиковать в LinkedIn без меня"
          disabled
          checked={false}
          readOnly
        />
        <span>
          <strong>Публиковать в LinkedIn без меня</strong>
          <small>Публикация всегда остаётся ручной.</small>
        </span>
      </label>
    </fieldset>
  );
}

function ModeChoices({
  busy,
  mode,
  onChange,
}: {
  readonly busy: boolean;
  readonly mode: CandidateAutomationMode;
  readonly onChange: (mode: CandidateAutomationMode) => void;
}) {
  return (
    <fieldset className="automation-mode-list" disabled={busy}>
      <legend>Режим</legend>
      <ModeChoice
        value="drafts_only"
        label="Только черновики"
        detail="Вы отправляете отклик самостоятельно."
        current={mode}
        onChange={onChange}
      />
      <ModeChoice
        value="approval_required"
        label="С одобрением"
        detail="Каждый отклик отправляется после вашего подтверждения."
        current={mode}
        onChange={onChange}
      />
      <ModeChoice
        value="automatic"
        label="Автоматически"
        detail="Пока недоступно: исполнитель без одобрения не подключён."
        current={mode}
        disabled
        onChange={onChange}
      />
    </fieldset>
  );
}

function ModeChoice({
  value,
  label,
  detail,
  current,
  disabled = false,
  onChange,
}: {
  readonly value: CandidateAutomationMode;
  readonly label: string;
  readonly detail: string;
  readonly current: CandidateAutomationMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: CandidateAutomationMode) => void;
}) {
  const id = `automation-mode-${value}`;
  return (
    <label className={`automation-consent-row${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
      <input
        id={id}
        type="radio"
        aria-label={label}
        name="automation-mode"
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function AutomaticConsent({
  busy,
  accepted,
  onChange,
  onOpenTariffs,
}: {
  readonly busy: boolean;
  readonly accepted: boolean;
  readonly onChange: (accepted: boolean) => void;
  readonly onOpenTariffs: () => void;
}) {
  return (
    <div className="automation-consent-extra">
      <label className="automation-consent-row" htmlFor="automation-automatic-consent">
        <input
          id="automation-automatic-consent"
          type="checkbox"
          disabled={busy}
          checked={accepted}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>Разрешаю отправлять отклики без отдельного одобрения каждого.</span>
      </label>
      <button type="button" className="automation-link-button" onClick={onOpenTariffs}>
        Посмотреть условия Pro
      </button>
    </div>
  );
}

function ConsentActions({
  busy,
  canSubmit,
  onClose,
}: {
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly onClose: () => void;
}) {
  return (
    <footer>
      <button className="career-btn career-btn-primary" type="submit" disabled={!canSubmit}>
        {busy ? 'Сохраняем…' : 'Включить режим'}
      </button>
      <button
        className="career-btn career-btn-secondary"
        type="button"
        disabled={busy}
        onClick={onClose}
      >
        Отмена
      </button>
    </footer>
  );
}

function consentKeysFor(mode: CandidateAutomationMode): string[] {
  return [
    ...REQUIRED_CONSENTS.map(([key]) => key),
    ...(mode === 'automatic' ? ['automatic_submission'] : []),
  ];
}

function toggleSetValue(current: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
