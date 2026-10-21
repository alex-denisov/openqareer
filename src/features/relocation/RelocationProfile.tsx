import { useState } from 'react';
import { ArrowRight, LockKey, PencilSimple, Trash } from '@phosphor-icons/react';
import {
  RELOCATION_STEPS,
  emptyRelocationQuestionnaire,
  type RelocationAlert,
  type RelocationConsentState,
  type RelocationQuestionnaire as RelocationQuestionnaireData,
  type RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { apiErrorMessage } from '../coach/apiClient';
import { restartRelocationQuestionnaire, revokeRelocationConsent } from './relocationApi';
import { listRelocationCountries } from './relocationCountryData';
import { RelocationQuestionnaire } from './RelocationQuestionnaire';
import {
  citizenshipRowId,
  relocationLanguageSourceLabel,
  removeRelocationItem,
  saveRelocationStep,
} from './relocationProfileItems';

const STEP_SECTIONS: readonly {
  readonly step: RelocationStepId;
  readonly title: string;
}[] = [
  { step: 'citizenship_documents', title: 'Гражданство и документы' },
  { step: 'education', title: 'Образование и сертификаты' },
  { step: 'family', title: 'Семья и сроки' },
  { step: 'languages', title: 'Языки' },
];

export interface RelocationProfileProps {
  readonly profile: RelocationQuestionnaireData;
  readonly consent: RelocationConsentState;
  readonly alerts: readonly RelocationAlert[];
  readonly onProfileUpdated: (profile: RelocationQuestionnaireData, alerts?: readonly RelocationAlert[]) => void;
  readonly onConsentRevoked: (consent: RelocationConsentState) => void;
  readonly onShowCountries: () => void;
  readonly mobile?: boolean;
  /** 390: the questionnaire is the workspace's own push screen, not nested here. */
  readonly onEditStep?: (step: RelocationStepId) => void;
}

export function RelocationProfile(props: RelocationProfileProps) {
  const actions = useRelocationProfileActions(props);
  if (actions.editingStep) {
    return (
      <RelocationQuestionnaire
        profile={props.profile}
        initialStep={actions.editingStep}
        onClose={() => actions.setEditingStep(undefined)}
        onShowCountries={() => { actions.setEditingStep(undefined); props.onShowCountries(); }}
        onProfileUpdated={props.onProfileUpdated}
      />
    );
  }
  return <RelocationProfileView profile={props.profile} consent={props.consent} alerts={props.alerts} actions={actions} onEdit={actions.edit} onShowCountries={props.onShowCountries} />;
}

async function runProfileAction(
  action: 'revoke' | 'restart',
  callbacks: Pick<RelocationProfileProps, 'onProfileUpdated' | 'onConsentRevoked'>,
  setters: {
    setBusy: (value: boolean) => void;
    setError: (value: string | undefined) => void;
    setNotice: (value: string | undefined) => void;
    setConfirmRevoke: (value: boolean) => void;
    setConfirmRestart: (value: boolean) => void;
  },
) {
  setters.setBusy(true);
  setters.setError(undefined);
  try {
    if (action === 'revoke') {
      const result = await revokeRelocationConsent();
      callbacks.onConsentRevoked(result.consent);
      setters.setConfirmRevoke(false);
      setters.setNotice(result.deleted ? 'Согласие отозвано. Данные анкеты удалены.' : 'Согласие уже было отозвано.');
    } else {
      await restartRelocationQuestionnaire();
      callbacks.onProfileUpdated(emptyRelocationQuestionnaire(), []);
      setters.setConfirmRestart(false);
      setters.setNotice('Анкета очищена. Согласие осталось активным.');
    }
  } catch (reason) {
    setters.setError(apiErrorMessage(reason, action === 'revoke'
      ? 'Не удалось отозвать согласие. Повторите запрос.'
      : 'Не удалось очистить анкету. Повторите запрос.'));
  } finally {
    setters.setBusy(false);
  }
}

async function removeProfileItem(
  input: {
    readonly profile: RelocationQuestionnaireData;
    readonly step: RelocationStepId;
    readonly itemId: string;
    readonly onProfileUpdated: RelocationProfileProps['onProfileUpdated'];
  },
  setters: { setBusy: (value: boolean) => void; setError: (value: string | undefined) => void; setNotice: (value: string | undefined) => void },
) {
  setters.setBusy(true);
  setters.setError(undefined);
  try {
    const result = await saveRelocationStep(input.step, removeRelocationItem(input.profile, input.step, input.itemId));
    input.onProfileUpdated(result.profile, result.alerts);
    setters.setNotice('Запись удалена. Статусы стран пересчитаны.');
  } catch (reason) {
    setters.setError(apiErrorMessage(reason, 'Не удалось удалить запись. Повторите.'));
  } finally {
    setters.setBusy(false);
  }
}

function useRelocationProfileActions({
  profile,
  onProfileUpdated,
  onConsentRevoked,
  onEditStep,
}: RelocationProfileProps) {
  const [editingStep, setEditingStep] = useState<RelocationStepId>();
  const openStep = onEditStep ?? setEditingStep;
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const callbacks = { onProfileUpdated, onConsentRevoked };
  const setters = { setBusy, setError, setNotice, setConfirmRevoke, setConfirmRestart };
  const run = (action: 'revoke' | 'restart') => void runProfileAction(action, callbacks, setters);

  return {
    editingStep,
    setEditingStep,
    confirmRevoke,
    setConfirmRevoke,
    confirmRestart,
    setConfirmRestart,
    busy,
    error,
    notice,
    continueQuestionnaire: () => {
      if (profile.currentStep === 'summary') return;
      setNotice(undefined);
      openStep(profile.currentStep);
    },
    revoke: () => run('revoke'),
    removeItem: (step: RelocationStepId, itemId: string) => void removeProfileItem(
      { profile, step, itemId, onProfileUpdated },
      setters,
    ),
    restart: () => run('restart'),
    edit: (step: RelocationStepId) => { setNotice(undefined); openStep(step); },
  };
}

function RelocationProfileView({
  profile,
  consent,
  alerts,
  actions,
  onEdit,
  onShowCountries,
}: {
  readonly profile: RelocationQuestionnaireData;
  readonly consent: RelocationConsentState;
  readonly alerts: readonly RelocationAlert[];
  readonly actions: ReturnType<typeof useRelocationProfileActions>;
  readonly onEdit: (step: RelocationStepId) => void;
  readonly onShowCountries: () => void;
}) {
  return (
    <section className="career-relocation-profile" aria-labelledby="career-relocation-profile-title">
      <p className="career-relocation-note" role="note">
        <LockKey aria-hidden="true" size={17} />
        <span id="career-relocation-profile-title">
          Согласие на обработку данных о мобильности: дано {formatDate(consent.grantedAt)}. Отзыв согласия удаляет данные анкеты, релокация выключится.
        </span>
      </p>
      <RelocationProfileAlerts profile={profile} alerts={alerts} />
      {actions.notice ? <p className="career-relocation-success" role="status">{actions.notice}</p> : null}
      {actions.error ? <p className="career-relocation-error" role="alert">{actions.error}</p> : null}
      <div className="career-relocation-profile-sections">
        {STEP_SECTIONS.map(({ step, title }) => (
          <ProfileSection key={step} step={step} title={title} profile={profile} busy={actions.busy} onEdit={() => onEdit(step)} onDelete={(itemId) => actions.removeItem(step, itemId)} />
        ))}
      </div>
      <ProfileActions actions={actions} consent={consent} profile={profile} onShowCountries={onShowCountries} />
    </section>
  );
}

function RelocationProfileAlerts({
  profile,
  alerts,
}: {
  readonly profile: RelocationQuestionnaireData;
  readonly alerts: readonly RelocationAlert[];
}) {
  if (alerts.length === 0) return null;
  return (
    <aside className="career-relocation-threshold-warning" aria-label="Предупреждения профиля" role="status">
      <h3>Проверьте данные профиля</h3>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.kind === 'citizenship_missing' ? alert.kind : `${alert.kind}:${alert.documentId}:${alert.expiresAt}`}>
            {relocationAlertMessage(alert, profile)}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function relocationAlertMessage(alert: RelocationAlert, profile: RelocationQuestionnaireData): string {
  if (alert.kind === 'citizenship_missing') return 'Укажите страну гражданства, чтобы уточнить правила въезда.';
  const document = profile.citizenshipDocuments.documents.find((item) => item.id === alert.documentId);
  const state = alert.kind === 'document_expired' ? 'истёк' : 'истекает';
  return `Срок действия документа «${documentKind(document?.kind ?? '')}» ${state} ${formatDate(alert.expiresAt)}.`;
}

function profileContinueLabel(profile: RelocationQuestionnaireData): string {
  if (profile.currentStep === 'summary') return '';
  if (profile.currentStep === 'citizenship_documents') return 'Заполнить анкету';
  return `Продолжить с шага ${RELOCATION_STEPS.indexOf(profile.currentStep) + 1}`;
}

function ProfileActions({
  actions,
  consent,
  profile,
  onShowCountries,
}: {
  readonly actions: ReturnType<typeof useRelocationProfileActions>;
  readonly consent: RelocationConsentState;
  readonly profile: RelocationQuestionnaireData;
  readonly onShowCountries: () => void;
}) {
  return (
    <>
      <div className="career-relocation-profile-actions">
        <button className="career-btn career-btn-primary" type="button" onClick={onShowCountries}>
          <ArrowRight aria-hidden="true" size={17} />
          Показать страны
        </button>
        {profile.currentStep !== 'summary' ? (
          <button
            className="career-btn career-btn-secondary"
            type="button"
            disabled={actions.busy}
            onClick={actions.continueQuestionnaire}
          >
            {profileContinueLabel(profile)}
          </button>
        ) : null}
        <button className="career-btn career-btn-secondary" type="button" disabled={actions.busy} onClick={() => actions.setConfirmRestart(true)}>
          <Trash aria-hidden="true" size={16} />
          Начать заново
        </button>
        <button className="career-btn career-btn-destructive" type="button" disabled={actions.busy || !consent.granted} onClick={() => actions.setConfirmRevoke(true)}>
          Отозвать согласие и удалить данные
        </button>
      </div>
      {actions.confirmRestart ? <RestartConfirmation actions={actions} /> : null}
      {actions.confirmRevoke ? <RevokeConfirmation actions={actions} /> : null}
    </>
  );
}

function RestartConfirmation({ actions }: { readonly actions: ReturnType<typeof useRelocationProfileActions> }) {
  return (
    <ConfirmAction
      title="Очистить анкету?"
      description="Все поля анкеты будут удалены. Согласие останется активным."
      cancelLabel="Оставить данные"
      confirmLabel="Очистить анкету"
      busy={actions.busy}
      destructive
      onCancel={() => actions.setConfirmRestart(false)}
      onConfirm={actions.restart}
    />
  );
}

function RevokeConfirmation({ actions }: { readonly actions: ReturnType<typeof useRelocationProfileActions> }) {
  return (
    <ConfirmAction
      title="Отозвать согласие?"
      description="Отзыв удалит анкету релокации и отключит подбор стран."
      cancelLabel="Не отзывать"
      confirmLabel="Отозвать согласие и удалить данные"
      busy={actions.busy}
      destructive
      onCancel={() => actions.setConfirmRevoke(false)}
      onConfirm={actions.revoke}
    />
  );
}

function ProfileSection({
  step,
  title,
  profile,
  onEdit,
  onDelete,
  busy,
}: {
  readonly step: RelocationStepId;
  readonly title: string;
  readonly profile: RelocationQuestionnaireData;
  readonly onEdit: () => void;
  readonly onDelete: (itemId: string) => void;
  readonly busy: boolean;
}) {
  return (
    <section className="career-relocation-profile-section" aria-labelledby={`career-relocation-data-${step}`}>
      <header>
        <h3 id={`career-relocation-data-${step}`}>{title}</h3>
        <button className="career-btn career-btn-secondary" type="button" onClick={onEdit}>
          <PencilSimple aria-hidden="true" size={16} />
          Изменить
        </button>
      </header>
      <ProfileSectionContent step={step} profile={profile} actions={{ onEdit, onDelete, busy }} />
    </section>
  );
}

type RowActions = { readonly onEdit: () => void; readonly onDelete: (itemId: string) => void; readonly busy: boolean };

function ProfileSectionContent({
  step,
  profile,
  actions,
}: {
  readonly step: RelocationStepId;
  readonly profile: RelocationQuestionnaireData;
  readonly actions: RowActions;
}) {
  if (step === 'citizenship_documents') return <CitizenshipProfileRows profile={profile} actions={actions} />;
  if (step === 'education') return <EducationProfileRows profile={profile} actions={actions} />;
  if (step === 'family') return <FamilyProfileRow profile={profile} />;
  return <LanguageProfileRows profile={profile} actions={actions} />;
}

function CitizenshipProfileRows({ profile, actions }: { readonly profile: RelocationQuestionnaireData; readonly actions: RowActions }) {
  const citizenship = profile.citizenshipDocuments.citizenshipCountryCodes.map((code) => ({
    id: citizenshipRowId(code),
    label: `Гражданство: ${countryName(code)}`,
    value: 'со слов кандидата',
  }));
  const documents = profile.citizenshipDocuments.documents;
  if (!citizenship.length && !documents.length) return <EmptyProfileSection />;
  const rows = documents.map((document) => ({
    id: document.id,
    label: documentKind(document.kind),
    value: `${countryName(document.countryCode)}${document.expiresAt ? ` · до ${formatDate(document.expiresAt)}` : ''}`,
  }));
  return <ProfileRows rows={[...citizenship, ...rows]} actions={actions} />;
}

function EducationProfileRows({ profile, actions }: { readonly profile: RelocationQuestionnaireData; readonly actions: RowActions }) {
  const educationRows = profile.education.education.map(({ id, title, countryCode, recognitionStatus, completedAt }) => ({
    id,
    label: title,
    value: `${countryName(countryCode)} · ${recognitionLabel(recognitionStatus)}${completedAt ? ` · ${completedAt.slice(0, 4)}` : ''}`,
  }));
  const certificateRows = profile.education.certificates.map(({ id, title, issuer, recognitionStatus }) => ({
    id,
    label: title,
    value: `${issuer ?? 'Выдавшая организация не указана'} · ${recognitionLabel(recognitionStatus)}`,
  }));
  const rows = [...educationRows, ...certificateRows];
  return rows.length ? <ProfileRows rows={rows} actions={actions} /> : <EmptyProfileSection />;
}

function FamilyProfileRow({ profile }: { readonly profile: RelocationQuestionnaireData }) {
  const { family } = profile;
  const partner = family.partnerStatus === 'has_partner'
    ? 'С партнёром'
    : family.partnerStatus === 'no_partner' ? 'Один' : 'Не указано';
  const children = family.childrenCount === undefined ? 'Число детей не указано' : `Детей: ${family.childrenCount}`;
  return <ProfileRow label={partner} value={`${children} · ${timeframeLabel(family.relocationTimeframe)}`} />;
}

function LanguageProfileRows({ profile, actions }: { readonly profile: RelocationQuestionnaireData; readonly actions: RowActions }) {
  const rows = profile.languages.languages.map((language) => ({
    id: language.id,
    label: `${language.name}: ${language.level === 'unknown' ? 'уровень не указан' : language.level}`,
    value: language.sourceLabel ?? relocationLanguageSourceLabel(language.source),
  }));
  return rows.length ? <ProfileRows rows={rows} actions={actions} /> : <EmptyProfileSection />;
}

function ProfileRows({ rows, actions }: {
  readonly rows: readonly { readonly id: string; readonly label: string; readonly value: string }[];
  readonly actions: RowActions;
}) {
  return (
    <div className="career-relocation-profile-list">
      {rows.map((row) => (
        <div key={row.id} className="career-relocation-profile-row">
          <strong>{row.label}</strong>
          <span>{row.value}</span>
          <span className="career-relocation-row-actions">
            <button className="career-relocation-icon-button" type="button" aria-label={`Изменить: ${row.label}`} onClick={actions.onEdit}>
              <PencilSimple aria-hidden="true" size={17} />
            </button>
            <button className="career-relocation-icon-button" type="button" aria-label={`Удалить: ${row.label}`} disabled={actions.busy} onClick={() => actions.onDelete(row.id)}>
              <Trash aria-hidden="true" size={17} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function ProfileRow({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="career-relocation-profile-row"><strong>{label}</strong><span>{value}</span></div>;
}

function EmptyProfileSection() {
  return <p>Нет данных. Их можно добавить в анкете.</p>;
}

function ConfirmAction({
  title,
  description,
  cancelLabel,
  confirmLabel,
  busy,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly destructive?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="career-relocation-confirm" role="group" aria-labelledby="career-relocation-confirm-title">
      <h3 id="career-relocation-confirm-title">{title}</h3>
      <p>{description}</p>
      <div>
        <button className="career-btn career-btn-secondary" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className={destructive ? 'career-btn career-btn-destructive' : 'career-btn career-btn-primary'} type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Выполняем…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

function countryName(code: string): string {
  return listRelocationCountries().find((country) => country.countryCode === code)?.name ?? 'Страна не определена';
}

function documentKind(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    residence_permit: 'Вид на жительство',
    work_permit: 'Разрешение на работу',
    work_visa: 'Рабочая виза',
    study_visa: 'Учебная виза',
    visa: 'Виза',
    other: 'Другой документ',
  };
  return labels[kind] ?? 'Документ';
}

function recognitionLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    recognized: 'признано',
    in_progress: 'признание в процессе',
    not_started: 'не подавалось на признание',
    not_required: 'признание не требуется',
    unknown: 'не проверено',
  };
  return labels[status] ?? 'неизвестно';
}

function timeframeLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    under_two_weeks: 'не больше двух недель',
    under_three_months: 'до трёх месяцев',
    three_to_six_months: 'от трёх до шести месяцев',
    six_to_twelve_months: 'от шести до двенадцати месяцев',
    over_twelve_months: 'дольше, если надёжно',
    unknown: 'срок не указан',
  };
  return labels[value] ?? 'срок не указан';
}

function formatDate(value: string | null): string {
  if (!value) return 'не указано';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'неизвестная дата' : new Intl.DateTimeFormat('ru-RU').format(date);
}
