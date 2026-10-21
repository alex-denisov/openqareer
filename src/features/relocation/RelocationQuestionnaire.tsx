import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRight, CaretLeft, LockKey } from '@phosphor-icons/react';
import {
  RELOCATION_STEPS,
  emptyRelocationQuestionnaire,
  relocationQuestionnaireStepSchemas,
  type RelocationAlert,
  type RelocationCurrentStep,
  type RelocationQuestionnaire,
  type RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { evaluateCountryFit } from '../../../shared/countryFit';
import { apiErrorMessage } from '../coach/apiClient';
import {
  importRelocationLanguagesFromLinkedIn,
  putRelocationQuestionnaireProgress,
  putRelocationQuestionnaireStep,
  restartRelocationQuestionnaire,
} from './relocationApi';
import { RelocationQuestionnaireStepForm } from './RelocationQuestionnaireSteps';
import { relocationLanguageInput, saveRelocationStep } from './relocationProfileItems';
import { listRelocationCountries, mobilityCandidateFromQuestionnaire } from './relocationCountryData';

const STEP_TITLES: Readonly<Record<RelocationStepId, string>> = {
  citizenship_documents: 'Гражданство и документы',
  education: 'Диплом и опыт',
  family: 'Семья и сроки',
  languages: 'Языки',
};

const STEP_DESCRIPTIONS: Readonly<Record<RelocationStepId, string>> = {
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
  readonly mobile?: boolean;
}

interface QuestionnaireController {
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

type RelocationSummaryResult = {
  readonly country: (ReturnType<typeof listRelocationCountries>)[number];
  readonly fit: ReturnType<typeof evaluateCountryFit>;
};

export function RelocationQuestionnaire(props: RelocationQuestionnaireProps) {
  const controller = useQuestionnaireController(props);
  return <QuestionnaireView {...props} controller={controller} />;
}

function useQuestionnaireController(props: RelocationQuestionnaireProps): QuestionnaireController {
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
  mobile,
  controller,
}: RelocationQuestionnaireProps & { readonly controller: QuestionnaireController }) {
  const { step, isDirty } = controller;
  return (
    <div className="career-relocation career-relocation-questionnaire">
      <QuestionnaireHeader step={step} isDirty={isDirty} onClose={onClose} onConfirmLeave={() => controller.setConfirmLeave(true)}>
        <QuestionnaireStepper step={step} dirty={isDirty} busy={controller.busy} onSelect={controller.selectStep} />
      </QuestionnaireHeader>
      <QuestionnaireStatus notice={controller.notice} error={controller.error} />
      <QuestionnaireStepPanel controller={controller} onShowCountries={onShowCountries} mobile={mobile} />
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
      </div>
      <p>{step === 'summary' ? 'Анкета сохранена в разделе «Страны и релокация».' : `Шаг ${RELOCATION_STEPS.indexOf(step) + 1} из 4: ${STEP_DESCRIPTIONS[step]}`}</p>
      {children}
    </header>
  );
}

function QuestionnaireStepper({
  step,
  dirty,
  busy,
  onSelect,
}: {
  readonly step: RelocationCurrentStep;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly onSelect: (step: RelocationStepId) => void;
}) {
  return (
    <ol className="career-relocation-stepper" aria-label="Шаги анкеты">
      {RELOCATION_STEPS.map((item, index) => (
        <li key={item} aria-current={step === item ? 'step' : undefined}>
          <button type="button" disabled={busy || (dirty && step !== item)} aria-current={step === item ? 'step' : undefined} onClick={() => onSelect(item)}>
            <span>{index + 1}</span>{STEP_TITLES[item]}
          </button>
        </li>
      ))}
      <li aria-current={step === 'summary' ? 'step' : undefined}><span className="career-relocation-stepper-current">Итог</span></li>
    </ol>
  );
}

function QuestionnaireStatus({ notice, error }: { readonly notice?: string; readonly error?: string }) {
  return <>{notice ? <p className="career-relocation-success" role="status">{notice}</p> : null}{error ? <p className="career-relocation-error" role="alert">{error}</p> : null}</>;
}

function QuestionnaireStepPanel({
  controller,
  onShowCountries,
  mobile,
}: {
  readonly controller: QuestionnaireController;
  readonly onShowCountries: () => void;
  readonly mobile?: boolean;
}) {
  const step = controller.step;
  if (step === 'summary') {
    return <RelocationSummary profile={controller.savedProfile} onShowCountries={onShowCountries} onEdit={() => controller.selectStep(RELOCATION_STEPS[0])} />;
  }
  return <QuestionnaireStepEditor controller={controller} step={step} mobile={mobile} />;
}

function QuestionnaireStepEditor({ controller, step, mobile }: {
  readonly controller: QuestionnaireController;
  readonly step: RelocationStepId;
  readonly mobile?: boolean;
}) {
  const { draft, busy, importBusy } = controller;
  return (
    <div className="career-relocation-questionnaire-layout">
      <section className="career-relocation-questionnaire-form" aria-labelledby={`relocation-step-title-${step}`}>
        <h2 id={`relocation-step-title-${step}`}>{STEP_TITLES[step]}</h2>
        <RelocationQuestionnaireStepForm
          step={step}
          profile={draft}
          onProfileChange={controller.setDraft}
          onImportLinkedIn={controller.importLinkedInLanguages}
          importBusy={importBusy}
          importError={controller.error}
          mobile={mobile}
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
      <button className="career-btn career-btn-primary" type="button" disabled={busy} onClick={() => onNext(false)}>
        <ArrowRight aria-hidden="true" size={17} />{busy ? 'Сохраняем…' : step === 'languages' ? 'Показать итог' : 'Дальше'}
      </button>
      <button className="career-relocation-text-action" type="button" disabled={busy} onClick={() => onNext(true)}>Пропустить шаг</button>
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

function QuestionnaireReason({ step }: { readonly step: RelocationStepId }) {
  const text: Readonly<Record<RelocationStepId, string>> = {
    citizenship_documents: 'Гражданство и действующие документы влияют на право въезда и работы. Неизвестные правила остаются неизвестными.',
    education: 'Признание диплома влияет на требования конкретного визового пути. Стаж берётся из профиля, если он там указан.',
    family: 'Состав семьи и срок переезда учитываются только в тех правилах, где есть проверенные условия.',
    languages: 'Уровень языка помогает проверить требования пути. Импортированные значения нужно подтвердить.',
  };
  return (
    <aside className="career-relocation-questionnaire-reason" aria-labelledby="relocation-reason-title">
      <h2 id="relocation-reason-title">Зачем это нужно</h2>
      <p>{text[step]}</p>
      <p className="career-relocation-privacy-note">Данные хранятся в зашифрованном профиле и удаляются при отзыве согласия.</p>
    </aside>
  );
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
  const candidate = mobilityCandidateFromQuestionnaire(profile);
  const results = listRelocationCountries().map((country) => ({ country, fit: evaluateCountryFit(country.countryCode, candidate) }));
  return <RelocationSummaryContent results={results} profile={profile} onShowCountries={onShowCountries} onEdit={onEdit} />;
}

function RelocationSummaryContent({
  results,
  profile,
  onShowCountries,
  onEdit,
}: {
  readonly results: readonly RelocationSummaryResult[];
  readonly profile: RelocationQuestionnaire;
  readonly onShowCountries: () => void;
  readonly onEdit: () => void;
}) {
  const skipped = profile.skippedSteps.length > 0;
  return (
    <section className="career-relocation-summary" aria-labelledby="relocation-summary-title">
      <h2 id="relocation-summary-title">Анкета заполнена</h2>
      <p>{skipped ? 'Пропущенные шаги можно заполнить позже.' : 'Данные сохранены в профиле и не отправлены третьим лицам.'}</p>
      <div className="career-relocation-summary-list">
        {results.map(({ country, fit }) => (
          <article key={country.countryCode}>
            <strong>{country.name}</strong>
            <span>{countryStatus(fit.status)}</span>
            <p>{fit.scenarios.flatMap(({ reasons }) => reasons)[0] ?? 'По введённым данным нет дополнительных ограничений.'}</p>
          </article>
        ))}
      </div>
      <div className="career-relocation-country-actions">
        <button className="career-btn career-btn-primary" type="button" onClick={onShowCountries}><ArrowRight aria-hidden="true" size={17} />Показать страны</button>
        <button className="career-btn career-btn-secondary" type="button" onClick={onEdit}>Дополнить данные</button>
      </div>
    </section>
  );
}

function InlineConfirmation({
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
        <button className="career-btn career-btn-secondary" type="button" disabled={busy} onClick={onCancel}>{cancel}</button>
        <button className="career-btn career-btn-destructive" type="button" disabled={busy} onClick={onConfirm}>{confirm}</button>
      </div>
    </section>
  );
}

function countryStatus(status: string): string {
  if (status === 'available') return 'Без ограничений по известным условиям';
  if (status === 'barriers' || status === 'high_barriers') return 'Есть условия';
  if (status === 'unavailable' || status === 'legally_unavailable') return 'Право не подтверждено';
  return 'Нужно уточнить';
}
