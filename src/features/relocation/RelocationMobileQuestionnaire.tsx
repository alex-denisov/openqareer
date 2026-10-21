import { useState } from 'react';
import { ArrowRight, CheckCircle, Info } from '@phosphor-icons/react';
import { RELOCATION_STEPS, type RelocationStepId } from '../../../shared/relocationQuestionnaire';
import { evaluateCountryFit } from '../../../shared/countryFit';
import {
  InlineConfirmation,
  STEP_DESCRIPTIONS,
  useQuestionnaireController,
  type QuestionnaireController,
  type RelocationQuestionnaireProps,
} from './RelocationQuestionnaire';
import {
  listRelocationCountries,
  mobilityCandidateFromQuestionnaire,
} from './relocationCountryData';
import { MobilePush } from './RelocationMobilePush';
import {
  MobileCertificateEditor,
  MobileDocumentEditor,
  MobileEducationEditor,
  MobileLanguageEditor,
} from './mobile/MobileEditors';
import { MobileCountrySearch, MobileGroup, MobileNavRow, MobilePrimary } from './mobile/MobileRows';
import { MobileStepBody, type MobileSubScreen } from './mobile/MobileSteps';

/**
 * Mockup 15 at 390 (`mv=i1…i5`, `mv=doc`): the questionnaire as a push screen —
 * one large title, the step line, grouped rows, one accent «Дальше».
 * Each record (document, diploma, language) opens its own push screen.
 */
export function RelocationMobileQuestionnaire(props: RelocationQuestionnaireProps) {
  const controller = useQuestionnaireController(props);
  const [screen, setScreen] = useState<MobileSubScreen>();
  if (screen)
    return (
      <SubScreen controller={controller} screen={screen} onClose={() => setScreen(undefined)} />
    );
  if (controller.step === 'summary') return <MobileSummary {...props} controller={controller} />;
  return (
    <MobileStep {...props} controller={controller} step={controller.step} onOpen={setScreen} />
  );
}

function SubScreen({
  controller,
  screen,
  onClose,
}: {
  readonly controller: QuestionnaireController;
  readonly screen: MobileSubScreen;
  readonly onClose: () => void;
}) {
  const profile = controller.draft;
  const editor = { profile, onProfileChange: controller.setDraft, onClose };
  if (screen.kind === 'citizenship') {
    const codes = profile.citizenshipDocuments.citizenshipCountryCodes;
    const pick = (code: string) => {
      const next = screen.index === 0 ? [code, ...codes.slice(1)] : [codes[0] ?? '', code];
      controller.setDraft({
        ...profile,
        citizenshipDocuments: {
          ...profile.citizenshipDocuments,
          citizenshipCountryCodes: [...new Set(next.filter(Boolean))],
        },
      });
      onClose();
    };
    return (
      <MobileCountrySearch
        title={screen.index === 0 ? 'Гражданство' : 'Второе гражданство'}
        value={codes[screen.index] ?? ''}
        onPick={pick}
        onBack={onClose}
      />
    );
  }
  if (screen.kind === 'document') return <MobileDocumentEditor {...editor} rowId={screen.rowId} />;
  if (screen.kind === 'education')
    return <MobileEducationEditor {...editor} rowId={screen.rowId} />;
  if (screen.kind === 'certificate')
    return <MobileCertificateEditor {...editor} rowId={screen.rowId} />;
  return <MobileLanguageEditor {...editor} rowId={screen.rowId} />;
}

/** 390 shows the next step itself as feedback; only notices that say more stay. */
const QUIET_NOTICES = new Set(['Изменения сохранены.', 'Шаг пропущен. Его можно заполнить позже.']);

function Status({ controller }: { readonly controller: QuestionnaireController }) {
  const notice =
    controller.notice && !QUIET_NOTICES.has(controller.notice) ? controller.notice : undefined;
  return (
    <>
      {notice ? (
        <p className="career-relocation-success" role="status">
          {notice}
        </p>
      ) : null}
      {controller.error ? (
        <p className="career-relocation-error" role="alert">
          {controller.error}
        </p>
      ) : null}
    </>
  );
}

function LeaveConfirmation({
  controller,
  onClose,
}: {
  readonly controller: QuestionnaireController;
  readonly onClose: () => void;
}) {
  if (!controller.confirmLeave) return null;
  return (
    <InlineConfirmation
      title="Выйти без сохранения?"
      description="Изменения анкеты ещё не сохранены."
      cancel="Остаться"
      confirm="Выйти без сохранения"
      busy={controller.busy}
      onCancel={() => controller.setConfirmLeave(false)}
      onConfirm={onClose}
    />
  );
}

function MobileStep({
  controller,
  step,
  onClose,
  onOpen,
}: RelocationQuestionnaireProps & {
  readonly controller: QuestionnaireController;
  readonly step: RelocationStepId;
  readonly onOpen: (screen: MobileSubScreen) => void;
}) {
  const busy = controller.busy || controller.importBusy;
  const back = () => (controller.isDirty ? controller.setConfirmLeave(true) : onClose());
  return (
    <MobilePush title="Анкета" onBack={back}>
      <div className="vacancy-push-hero">
        <h2>Условия для переезда</h2>
        <p>
          Шаг {RELOCATION_STEPS.indexOf(step) + 1} из 4: {STEP_DESCRIPTIONS[step]}
        </p>
      </div>
      <LeaveConfirmation controller={controller} onClose={onClose} />
      <Status controller={controller} />
      <MobileStepBody
        step={step}
        profile={controller.draft}
        onProfileChange={controller.setDraft}
        onOpen={onOpen}
        onImportLinkedIn={controller.importLinkedInLanguages}
        importBusy={controller.importBusy}
      />
      <div className="career-relocation-mobile-actions">
        <MobilePrimary
          icon={<ArrowRight aria-hidden="true" size={17} />}
          label={controller.busy ? 'Сохраняем…' : step === 'languages' ? 'Показать итог' : 'Дальше'}
          disabled={busy}
          onClick={() => controller.moveToNext(false)}
        />
        <button
          className="vacancy-push-text career-relocation-skip"
          type="button"
          disabled={busy}
          onClick={() => controller.moveToNext(true)}
        >
          Пропустить шаг
        </button>
      </div>
    </MobilePush>
  );
}

function SummaryCountries({
  profile,
  onShowCountries,
}: {
  readonly profile: QuestionnaireController['savedProfile'];
  readonly onShowCountries: () => void;
}) {
  const candidate = mobilityCandidateFromQuestionnaire(profile);
  const results = listRelocationCountries().map((country) => ({
    country,
    fit: evaluateCountryFit(country.countryCode, candidate),
  }));
  const counts = new Map<string, number>();
  for (const { fit } of results) {
    const label = shortStatus(fit.status);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const line = [...counts]
    .map(([label, count]) => `${label.toLocaleLowerCase('ru')}: ${count}`)
    .join(', ');
  return (
    <MobileGroup
      caption="Что получилось"
      note={`Стран в каталоге правил: ${results.length}; ${line}.`}
    >
      {results.map(({ country, fit }) => (
        <MobileNavRow
          key={country.countryCode}
          icon={
            fit.status === 'available' ? (
              <CheckCircle aria-hidden="true" />
            ) : (
              <Info aria-hidden="true" />
            )
          }
          title={country.name}
          sub={
            fit.scenarios.flatMap(({ reasons }) => reasons)[0] ??
            'По введённым данным нет дополнительных ограничений.'
          }
          value={shortStatus(fit.status)}
          onClick={onShowCountries}
        />
      ))}
    </MobileGroup>
  );
}

/** Mockup 15 `mv=i5`: what the answers mean per country, one «Показать страны». */
function MobileSummary({
  controller,
  onClose,
  onShowCountries,
}: RelocationQuestionnaireProps & { readonly controller: QuestionnaireController }) {
  const profile = controller.savedProfile;
  const skipped = profile.skippedSteps.length > 0;
  return (
    <MobilePush title="Итог анкеты" onBack={onClose}>
      <div className="vacancy-push-hero">
        <h2>Анкета заполнена</h2>
        <p>
          {skipped
            ? 'Пропущенные шаги можно заполнить позже.'
            : 'Ничего не отправлено, всё сохранено в вашем профиле.'}
        </p>
      </div>
      <Status controller={controller} />
      <SummaryCountries profile={profile} onShowCountries={onShowCountries} />
      <div className="career-relocation-mobile-actions">
        <MobilePrimary
          icon={<ArrowRight aria-hidden="true" size={17} />}
          label="Показать страны"
          onClick={onShowCountries}
        />
        <button
          className="vacancy-push-text career-relocation-skip"
          type="button"
          onClick={() => controller.selectStep(RELOCATION_STEPS[0])}
        >
          Дополнить данные
        </button>
      </div>
    </MobilePush>
  );
}

function shortStatus(status: string): string {
  if (status === 'available') return 'Без ограничений';
  if (status === 'barriers' || status === 'high_barriers') return 'Барьеры';
  if (status === 'unavailable' || status === 'legally_unavailable') return 'Недоступно';
  return 'Уточнить';
}
