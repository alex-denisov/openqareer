import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRight, CaretLeft, CheckCircle, ShieldCheck, LockKey, PencilSimple, WarningCircle, XCircle } from '@phosphor-icons/react';
import {
  RELOCATION_STEPS,
  emptyRelocationQuestionnaire,
  relocationQuestionnaireStepSchemas,
  type RelocationAlert,
  type RelocationCurrentStep,
  type RelocationQuestionnaire,
  type RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { apiErrorMessage } from '../coach/apiClient';
import {
  importRelocationLanguagesFromLinkedIn,
  putRelocationQuestionnaireProgress,
  putRelocationQuestionnaireStep,
  restartRelocationQuestionnaire,
} from './relocationApi';
import { RelocationQuestionnaireStepForm } from './RelocationQuestionnaireSteps';
import { relocationLanguageInput, saveRelocationStep } from './relocationProfileItems';
import type { RelocationCountrySummary } from './relocationCountrySummary';
import {
  buildRelocationSummaryOverview,
  relocationCountsSentence,
  relocationMissingNote,
  type RelocationSummaryOverview,
} from './relocationSummaryOverview';

const STEP_TITLES: Readonly<Record<RelocationStepId, string>> = {
  citizenship_documents: 'Гражданство и документы',
  education: 'Диплом и опыт',
  family: 'Семья и сроки',
  languages: 'Языки',
};

export const STEP_DESCRIPTIONS: Readonly<Record<RelocationStepId, string>> = {
  citizenship_documents: 'гражданство и действующие документы. Это определяет, какие страны вам доступны без визы.',
  education: 'диплом и опыт. Признание диплома и стаж открывают визы под оффер.',
  family: 'семья и сроки. От них зависят сценарии с семьёй и путь к ПМЖ.',
  languages: 'языки. Местный язык расширяет список вакансий.',
};

type ProfileUpdate = (profile: RelocationQuestionnaire, alerts?: readonly RelocationAlert[]) => void;

export interface RelocationQuestionnaireProps {
  readonly profile: RelocationQuestionnaire;
  readonly initialStep: RelocationStepId;
  readonly onClose: () => void;
  readonly onShowCountries: () => void;
  readonly onProfileUpdated: ProfileUpdate;
}

export interface QuestionnaireController {
  readonly savedProfile: RelocationQuestionnaire;
  readonly draft: RelocationQuestionnaire;
  readonly step: RelocationCurrentStep;
  readonly busy: boolean;
  readonly importBusy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly isDirty: boolean;
  readonly confirmLeave: boolean;
  readonly confirmRestart: boolean;
  readonly setDraft: (profile: RelocationQuestionnaire) => void;
  readonly setConfirmLeave: (value: boolean) => void;
  readonly setConfirmRestart: (value: boolean) => void;
  readonly moveToNext: (skip: boolean) => void;
  readonly selectStep: (step: RelocationStepId) => void;
  readonly importLinkedInLanguages: () => void;
  readonly restart: () => void;
}

export function RelocationQuestionnaire(props: RelocationQuestionnaireProps) {
  const controller = useQuestionnaireController(props);
  return <QuestionnaireView {...props} controller={controller} />;
}

export function useQuestionnaireController(props: RelocationQuestionnaireProps): QuestionnaireController {
  const [savedProfile, setSavedProfile] = useState(props.profile);
  const [draft, setDraft] = useState(props.profile);
  const [step, setStep] = useState<RelocationCurrentStep>(props.initialStep);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const isDirty = useMemo(() => !sameQuestionnaireData(savedProfile, draft), [draft, savedProfile]);
  const moveToNext = (skip: boolean) => void advanceQuestionnaire({
    step, skip, savedProfile, draft, busy, setBusy, setError, setNotice, setSavedProfile, setDraft, setStep, onProfileUpdated: props.onProfileUpdated,
  });
  const selectStep = (next: RelocationStepId) => void selectQuestionnaireStep({
    next, step, savedProfile, draft, busy, isDirty, setBusy, setError, setSavedProfile, setDraft, setStep, onProfileUpdated: props.onProfileUpdated,
  });
  const importLinkedIn = () => void importQuestionnaireLanguages({
    savedProfile, draft, isDirty, setImportBusy, setError, setNotice, setSavedProfile, setDraft, onProfileUpdated: props.onProfileUpdated,
  });
  const restart = () => void restartQuestionnaire({
    busy, setBusy, setError, setNotice, setSavedProfile, setDraft, setStep, setConfirmRestart, onProfileUpdated: props.onProfileUpdated,
  });
  return {
    savedProfile, draft, step, busy, importBusy, error, notice, isDirty, confirmLeave, confirmRestart,
    setDraft, setConfirmLeave, setConfirmRestart, moveToNext, selectStep, importLinkedInLanguages: importLinkedIn, restart,
  };
}

function QuestionnaireView({
  onClose,
  onShowCountries,
  controller,
}: RelocationQuestionnaireProps & { readonly controller: QuestionnaireController }) {
  const { step, isDirty } = controller;
  return (
    <div className="career-relocation career-relocation-questionnaire">
      <QuestionnaireHeader step={step} isDirty={isDirty} onClose={onClose} onConfirmLeave={() => controller.setConfirmLeave(true)}>
        <QuestionnaireStepper step={step} dirty={isDirty} busy={controller.busy} skipped={controller.savedProfile.skippedSteps} onSelect={controller.selectStep} />
      </QuestionnaireHeader>
      <QuestionnaireStatus notice={step === 'summary' ? undefined : controller.notice} error={controller.error} />
      <QuestionnaireStepPanel controller={controller} onShowCountries={onShowCountries} />
      <QuestionnaireDialogs controller={controller} onClose={onClose} />
    </div>
  );
}

function QuestionnaireHeader({
  step,
  isDirty,
  onClose,
  onConfirmLeave,
  children,
}: {
  readonly step: RelocationCurrentStep;
  readonly isDirty: boolean;
  readonly onClose: () => void;
  readonly onConfirmLeave: () => void;
  readonly children: ReactNode;
}) {
  return (
    <header className="career-relocation-card career-relocation-header">
      <div className="career-relocation-title-row">
        <button className="career-relocation-back" type="button" aria-label="Назад" onClick={() => isDirty ? onConfirmLeave() : onClose()}>
          <CaretLeft aria-hidden="true" size={20} />
        </button>
        <h2 id="career-relocation-questionnaire-title">Условия для переезда</h2>
        <span className="career-relocation-status"><LockKey aria-hidden="true" size={14} />Видите только вы</span>
        <span className="career-relocation-save-note"><CheckCircle aria-hidden="true" size={16} />Прогресс сохраняется</span>
      </div>
      <p>{step === 'summary' ? 'Анкета заполнена. Ничего не отправлено, всё сохранено в вашем профиле.' : `Шаг ${RELOCATION_STEPS.indexOf(step) + 1} из 4: ${DESKTOP_STEP_DESCRIPTIONS[step]}`}</p>
      {children}
    </header>
  );
}

type StepState = 'done' | 'current' | 'future' | 'skipped';

/** Mockup 15 `i1…i5`: a filled step is a green check, the current one a blue dot, a skipped one stays empty. */
function stepState(
  item: RelocationCurrentStep,
  step: RelocationCurrentStep,
  skipped: readonly RelocationStepId[],
): StepState {
  if (item === step) return 'current';
  const order = [...RELOCATION_STEPS, 'summary'] as const;
  if (order.indexOf(item) > order.indexOf(step)) return 'future';
  return item !== 'summary' && skipped.includes(item) ? 'skipped' : 'done';
}

function StepMark({ state }: { readonly state: StepState }) {
  if (state === 'done') return <CheckCircle className="career-relocation-step-mark" aria-hidden="true" size={16} />;
  return <span className="career-relocation-step-mark" aria-hidden="true" />;
}

function QuestionnaireStepper({
  step,
  dirty,
  busy,
  skipped,
  onSelect,
}: {
  readonly step: RelocationCurrentStep;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly skipped: readonly RelocationStepId[];
  readonly onSelect: (step: RelocationStepId) => void;
}) {
  const summaryState = stepState('summary', step, skipped);
  return (
    <ol className="career-relocation-stepper" aria-label="Шаги анкеты">
      {RELOCATION_STEPS.map((item) => {
        const state = stepState(item, step, skipped);
        return (
          <li key={item} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <button type="button" disabled={busy || (dirty && step !== item)} aria-current={state === 'current' ? 'step' : undefined} onClick={() => onSelect(item)}>
              <StepMark state={state} /><span>{STEP_TITLES[item]}</span>{state === 'skipped' ? <span className="career-sr-only"> (пропущен)</span> : null}
            </button>
          </li>
        );
      })}
      <li data-state={summaryState} aria-current={summaryState === 'current' ? 'step' : undefined}>
        <span className="career-relocation-stepper-current"><StepMark state={summaryState} /><span>Итог</span></span>
      </li>
    </ol>
  );
}

function QuestionnaireStatus({ notice, error }: { readonly notice?: string; readonly error?: string }) {
  return <>{notice ? <p className="career-relocation-success" role="status">{notice}</p> : null}{error ? <p className="career-relocation-error" role="alert">{error}</p> : null}</>;
}

function QuestionnaireStepPanel({
  controller,
  onShowCountries,
}: {
  readonly controller: QuestionnaireController;
  readonly onShowCountries: () => void;
}) {
  const step = controller.step;
  if (step === 'summary') {
    return <RelocationSummary profile={controller.savedProfile} onShowCountries={onShowCountries} onEdit={() => controller.selectStep(RELOCATION_STEPS[0])} />;
  }
  return <QuestionnaireStepEditor controller={controller} step={step} />;
}

function QuestionnaireStepEditor({ controller, step }: {
  readonly controller: QuestionnaireController;
  readonly step: RelocationStepId;
}) {
  const { draft, busy, importBusy } = controller;
  return (
    <div className="career-relocation-questionnaire-layout">
      <section className="career-relocation-questionnaire-form" aria-labelledby={`relocation-step-title-${step}`}>
        <h2 id={`relocation-step-title-${step}`}>{step === 'education' ? 'Образование' : STEP_TITLES[step]}</h2>
        <RelocationQuestionnaireStepForm
          step={step}
          profile={draft}
          onProfileChange={controller.setDraft}
          onImportLinkedIn={controller.importLinkedInLanguages}
          importBusy={importBusy}
          importError={controller.error}
        />
        <QuestionnaireStepActions step={step} busy={busy || importBusy} onNext={controller.moveToNext} />
      </section>
      <QuestionnaireReason step={step} />
    </div>
  );
}

function QuestionnaireStepActions({
  step,
  busy,
  onNext,
}: {
  readonly step: RelocationStepId;
  readonly busy: boolean;
  readonly onNext: (skip: boolean) => void;
}) {
  return (
    <div className="career-relocation-list-footer">
      <button className="career-relocation-btn is-primary" type="button" disabled={busy} onClick={() => onNext(false)}>
        <ArrowRight aria-hidden="true" size={17} />{busy ? 'Сохраняем…' : step === 'languages' ? 'Показать итог' : 'Дальше'}
      </button>
      <button className="career-relocation-btn is-ghost" type="button" disabled={busy} onClick={() => onNext(true)}>Пропустить шаг</button>
    </div>
  );
}


function QuestionnaireDialogs({
  controller,
  onClose,
}: {
  readonly controller: QuestionnaireController;
  readonly onClose: () => void;
}) {
  return (
    <>
      {controller.confirmLeave ? <InlineConfirmation title="Выйти без сохранения?" description="Изменения анкеты ещё не сохранены." cancel="Остаться" confirm="Выйти без сохранения" busy={controller.busy} onCancel={() => controller.setConfirmLeave(false)} onConfirm={onClose} /> : null}
      {controller.confirmRestart ? <InlineConfirmation title="Начать анкету заново?" description="Сохранённые сведения будут удалены. Согласие останется активным." cancel="Оставить анкету" confirm="Начать заново и удалить данные" busy={controller.busy} onCancel={() => controller.setConfirmRestart(false)} onConfirm={controller.restart} /> : null}
    </>
  );
}

interface AdvanceInput {
  readonly step: RelocationCurrentStep;
  readonly skip: boolean;
  readonly savedProfile: RelocationQuestionnaire;
  readonly draft: RelocationQuestionnaire;
  readonly busy: boolean;
  readonly setBusy: Setter<boolean>;
  readonly setError: Setter<string | undefined>;
  readonly setNotice: Setter<string | undefined>;
  readonly setSavedProfile: Setter<RelocationQuestionnaire>;
  readonly setDraft: Setter<RelocationQuestionnaire>;
  readonly setStep: Setter<RelocationCurrentStep>;
  readonly onProfileUpdated: ProfileUpdate;
}

type Setter<T> = Dispatch<SetStateAction<T>>;

async function advanceQuestionnaire(input: AdvanceInput) {
  if (input.step === 'summary' || input.busy) return;
  const validationError = input.skip ? undefined : validateStep(input.step, input.draft);
  if (validationError) {
    input.setError(validationError);
    return;
  }
  input.setBusy(true);
  input.setError(undefined);
  input.setNotice(undefined);
  try {
    const stepResult = input.skip ? undefined : await saveRelocationStep(input.step, input.draft);
    const base = stepResult?.profile ?? input.savedProfile;
    const skippedSteps = input.skip
      ? [...new Set([...base.skippedSteps, input.step])]
      : [...base.skippedSteps];
    if (stepResult) {
      input.setSavedProfile(base);
      input.setDraft(base);
      input.onProfileUpdated(base, stepResult.alerts);
    }
    await saveProgress(input, base, nextStepAfter(input.step), skippedSteps);
    input.setNotice(input.skip ? 'Шаг пропущен. Его можно заполнить позже.' : 'Изменения сохранены.');
  } catch (reason) {
    input.setError(questionnaireError(reason));
  } finally {
    input.setBusy(false);
  }
}

async function saveProgress(
  input: Pick<AdvanceInput, 'setSavedProfile' | 'setDraft' | 'setStep' | 'onProfileUpdated'>,
  profile: RelocationQuestionnaire,
  currentStep: RelocationCurrentStep,
  skippedSteps: readonly RelocationStepId[],
) {
  const result = await putRelocationQuestionnaireProgress(
    { currentStep, skippedSteps: skippedSteps.filter((item) => item !== currentStep) },
    profile.revision,
  );
  input.setSavedProfile(result.profile);
  input.setDraft(result.profile);
  input.setStep(result.profile.currentStep);
  input.onProfileUpdated(result.profile, result.alerts);
}

interface SelectStepInput {
  readonly next: RelocationStepId;
  readonly step: RelocationCurrentStep;
  readonly savedProfile: RelocationQuestionnaire;
  readonly draft: RelocationQuestionnaire;
  readonly busy: boolean;
  readonly isDirty: boolean;
  readonly setBusy: Setter<boolean>;
  readonly setError: Setter<string | undefined>;
  readonly setSavedProfile: Setter<RelocationQuestionnaire>;
  readonly setDraft: Setter<RelocationQuestionnaire>;
  readonly setStep: Setter<RelocationCurrentStep>;
  readonly onProfileUpdated: ProfileUpdate;
}

async function selectQuestionnaireStep(input: SelectStepInput) {
  if (input.busy || input.isDirty || input.next === input.step) return;
  input.setBusy(true);
  input.setError(undefined);
  try {
    const result = await putRelocationQuestionnaireProgress(
      { currentStep: input.next, skippedSteps: input.savedProfile.skippedSteps.filter((item) => item !== input.next) },
      input.savedProfile.revision,
    );
    input.setSavedProfile(result.profile);
    input.setDraft(result.profile);
    input.setStep(result.profile.currentStep);
    input.onProfileUpdated(result.profile, result.alerts);
  } catch (reason) {
    input.setError(questionnaireError(reason));
  } finally {
    input.setBusy(false);
  }
}

interface ImportLanguagesInput {
  readonly savedProfile: RelocationQuestionnaire;
  readonly draft: RelocationQuestionnaire;
  readonly isDirty: boolean;
  readonly setImportBusy: Setter<boolean>;
  readonly setError: Setter<string | undefined>;
  readonly setNotice: Setter<string | undefined>;
  readonly setSavedProfile: Setter<RelocationQuestionnaire>;
  readonly setDraft: Setter<RelocationQuestionnaire>;
  readonly onProfileUpdated: ProfileUpdate;
}

async function importQuestionnaireLanguages(input: ImportLanguagesInput) {
  input.setImportBusy(true);
  input.setError(undefined);
  try {
    const current = input.isDirty
      ? (await putRelocationQuestionnaireStep('languages', relocationLanguageInput(input.draft), input.savedProfile.revision)).profile
      : input.savedProfile;
    const result = await importRelocationLanguagesFromLinkedIn(current.revision);
    input.setSavedProfile(result.profile);
    input.setDraft(result.profile);
    input.onProfileUpdated(result.profile, result.alerts);
    input.setNotice('Языки добавлены как предложения. Проверьте каждое значение.');
  } catch (reason) {
    input.setError(questionnaireError(reason));
  } finally {
    input.setImportBusy(false);
  }
}

interface RestartInput {
  readonly busy: boolean;
  readonly setBusy: Setter<boolean>;
  readonly setError: Setter<string | undefined>;
  readonly setNotice: Setter<string | undefined>;
  readonly setSavedProfile: Setter<RelocationQuestionnaire>;
  readonly setDraft: Setter<RelocationQuestionnaire>;
  readonly setStep: Setter<RelocationCurrentStep>;
  readonly setConfirmRestart: Setter<boolean>;
  readonly onProfileUpdated: ProfileUpdate;
}

async function restartQuestionnaire(input: RestartInput) {
  if (input.busy) return;
  input.setBusy(true);
  input.setError(undefined);
  try {
    await restartRelocationQuestionnaire();
    const fresh = emptyRelocationQuestionnaire();
    input.setSavedProfile(fresh);
    input.setDraft(fresh);
    input.setStep(RELOCATION_STEPS[0]);
    input.setConfirmRestart(false);
    input.setNotice('Анкета очищена. Согласие осталось активным.');
    input.onProfileUpdated(fresh, []);
  } catch (reason) {
    input.setError(questionnaireError(reason));
  } finally {
    input.setBusy(false);
  }
}

function validateStep(step: RelocationStepId, profile: RelocationQuestionnaire): string | undefined {
  const result = relocationQuestionnaireStepSchemas[step].safeParse(profileStepData(step, profile));
  return result.success ? undefined : 'Проверьте обязательные поля и даты шага.';
}

function profileStepData(step: RelocationStepId, profile: RelocationQuestionnaire) {
  if (step === 'citizenship_documents') return profile.citizenshipDocuments;
  if (step === 'education') return profile.education;
  if (step === 'family') return profile.family;
  return profile.languages;
}

function nextStepAfter(step: RelocationStepId): RelocationCurrentStep {
  const index = RELOCATION_STEPS.indexOf(step);
  return RELOCATION_STEPS[index + 1] ?? 'summary';
}

function sameQuestionnaireData(saved: RelocationQuestionnaire, draft: RelocationQuestionnaire): boolean {
  return RELOCATION_STEPS.every((step) => JSON.stringify(profileStepData(step, saved)) === JSON.stringify(profileStepData(step, draft)));
}

function questionnaireError(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'code' in reason) {
    if (reason.code === 'relocation_profile_revision_conflict') return 'Анкета изменилась в другом окне. Обновите данные и повторите.';
    if (reason.code === 'relocation_consent_required') return 'Согласие отозвано. Данные анкеты удалены.';
  }
  return apiErrorMessage(reason, 'Не удалось сохранить шаг анкеты. Повторите запрос.');
}

const REASON_TEXT: Readonly<Record<RelocationStepId, string>> = {
  citizenship_documents: 'Гражданство и ВНЖ решают, нужна ли вам рабочая виза вообще. Например, с ВНЖ Сербии в стране можно работать, а в ЕАЭС работа без разрешения возможна только гражданам стран союза.',
  education: 'Признание диплома и сертификаты влияют на Blue Card и Skilled Worker: без них порог зарплаты выше или доступа нет. Стаж мы не просим вводить заново, он берётся из подтверждённого опыта.',
  family: 'Семья меняет сценарии: у одних виз партнёр может работать сразу, у других нет. Срок оформления отделяет «мгновенный старт» от «долго, но надёжно».',
  languages: 'Язык работы определяет, хватит ли английского. В Германии он часто решающий для собеседований и быта; для ОАЭ и Казахстана достаточно английского или русского.',
};

/** Desktop step lines of mockup 15 `i1…i4`. */
const DESKTOP_STEP_DESCRIPTIONS: Readonly<Record<RelocationStepId, string>> = {
  citizenship_documents: 'гражданство и действующие документы. Это определяет, какие страны вам доступны без визы.',
  education: 'образование и сертификаты. Всё, что есть в профиле, уже подставлено, проверьте.',
  family: 'с кем вы едете и сколько готовы ждать оформление.',
  languages: 'языки. Уровни взяты из профиля, дополните местные.',
};

function QuestionnaireAside({ text }: { readonly text: string }) {
  return (
    <aside className="career-relocation-questionnaire-reason" aria-labelledby="relocation-reason-title">
      <div className="career-relocation-reason-head">
        <h2 id="relocation-reason-title">Зачем это нужно</h2>
      </div>
      <p>{text}</p>
      <p className="career-relocation-privacy-note">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>Данные хранятся в разделе «Страны и релокация», вкладка «Мои данные», в профиле только сводка. Третьим лицам не передаются, удалить можно в любой момент.</span>
      </p>
      <p>Любое поле можно пропустить: страны, зависящие от него, получат статус «нужно уточнить», а не угаданный.</p>
    </aside>
  );
}

function QuestionnaireReason({ step }: { readonly step: RelocationStepId }) {
  return <QuestionnaireAside text={REASON_TEXT[step]} />;
}

function RelocationSummary({
  profile,
  onShowCountries,
  onEdit,
}: {
  readonly profile: RelocationQuestionnaire;
  readonly onShowCountries: () => void;
  readonly onEdit: () => void;
}) {
  const overview = useMemo(() => buildRelocationSummaryOverview(profile), [profile]);
  return (
    <div className="career-relocation-questionnaire-layout">
      <section className="career-relocation-summary" aria-labelledby="relocation-summary-title">
        <div className="career-relocation-summary-head">
          <h2 id="relocation-summary-title">Что получилось</h2>
          <span className="career-relocation-status is-enabled"><CheckCircle aria-hidden="true" size={14} />Релокация включена</span>
        </div>
        <SummaryNote overview={overview} />
        <ul className="career-relocation-summary-list">
          {overview.key.map((summary) => (
            <li key={summary.countryCode} data-status={summary.status}>
              <StatusIcon status={summary.status} />
              <div>
                <div className="career-relocation-summary-row-head">
                  <strong>{summary.name}</strong>
                  <span className={`career-relocation-summary-badge career-relocation-country-status is-${summary.status}`}>{summary.statusLabel}</span>
                </div>
                <p>{summary.reason}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="career-relocation-country-actions">
          <button className="career-relocation-btn is-primary" type="button" onClick={onShowCountries}><ArrowRight aria-hidden="true" size={17} />Показать страны</button>
          <button className="career-relocation-btn" type="button" onClick={onEdit}><PencilSimple aria-hidden="true" size={17} />Дополнить данные</button>
        </div>
      </section>
      <QuestionnaireAside text="Подборка теперь учитывает отмеченные страны. Данные можно править на вкладке «Мои данные» и в блоке «Условия и география»." />
    </div>
  );
}

function SummaryNote({ overview }: { readonly overview: RelocationSummaryOverview }) {
  const clarify = overview.unknown.slice(0, 2);
  return (
    <p className="career-relocation-summary-note">
      <CheckCircle aria-hidden="true" size={16} />
      <span>
        {relocationCountsSentence(overview.counts)}
        {clarify.length ? ' Например: ' : ''}
        {clarify.map((summary, index) => (
          <span key={summary.countryCode}>
            {index ? ' и ' : ''}<b>{summary.name}</b> ({relocationMissingNote(summary)})
          </span>
        ))}
        {clarify.length ? '.' : ''}
      </span>
    </p>
  );
}

function StatusIcon({ status }: { readonly status: RelocationCountrySummary['status'] }) {
  if (status === 'available') return <CheckCircle className="career-relocation-summary-icon" aria-hidden="true" size={20} />;
  if (status === 'legally_unavailable') return <XCircle className="career-relocation-summary-icon" aria-hidden="true" size={20} />;
  return <WarningCircle className="career-relocation-summary-icon" aria-hidden="true" size={20} />;
}

export function InlineConfirmation({
  title,
  description,
  cancel,
  confirm,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <section className="career-relocation-confirm" role="group" aria-labelledby="relocation-confirm-title">
      <h3 id="relocation-confirm-title">{title}</h3>
      <p>{description}</p>
      <div>
        <button className="career-relocation-btn" type="button" disabled={busy} onClick={onCancel}>{cancel}</button>
        <button className="career-relocation-btn is-danger" type="button" disabled={busy} onClick={onConfirm}>{confirm}</button>
      </div>
    </section>
  );
}

