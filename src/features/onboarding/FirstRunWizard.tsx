import { CaretLeft, Check, PencilSimple } from '@phosphor-icons/react';

import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import type { FirstRunData, FirstRunStep } from './firstRunTypes';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';
import { FirstRunConsultant } from './FirstRunConsultant';
import {
  FirstRunEmptySources,
  FirstRunPartialSources,
  FirstRunStaleLoading,
} from './FirstRunStates';
import { fileStaleLabel } from './firstRunSpecialState';
import { useLongWait } from './useLongWait';
import { FirstRunContextCard, FirstRunGoalCard, FirstRunSourceCard } from './FirstRunSteps';
import { useFirstRunWizardState } from './useFirstRunWizardState';
import { useResumeIngestion } from '../journey/useResumeIngestion';
import type { IngestedResume, ResumeIngestionState } from '../journey/useResumeIngestion';

export interface FirstRunWizardProps {
  readonly initialStep?: FirstRunStep;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  /** Ровно один коннектор подключён на сервере (см. useFirstRunSpecialState). */
  readonly partialSourcesMessage?: string | null;
  /** Долгое чтение подключённого источника: «Читаем LinkedIn: раздел 2 из 5». */
  readonly importProgressLabel?: string | null;
  readonly onStartedChange?: (started: boolean) => void;
  readonly onOpenConsultant: (prompt?: string) => void;
  readonly onConnectSource?: (source: 'linkedin' | 'hh') => void;
  readonly showConsultantPanel?: boolean;
  readonly isMobile?: boolean;
  readonly hasAccount?: boolean;
  readonly ingestion?: ResumeIngestionState;
}

function StepsBar({ step }: { readonly step: FirstRunStep }): ReactElement {
  const stepIdx = step === 'goal' ? 1 : step === 'source' ? 2 : 3;
  const stepName = step === 'goal' ? 'Цель' : step === 'source' ? 'Источник' : 'Контекст';

  return (
    <div className="first-run-steps-bar" role="img" aria-label={`Шаг ${stepIdx} из 3: ${stepName}`}>
      <div className="first-run-step-indicator">
        <span className={`first-run-step-dot ${stepIdx >= 1 ? 'is-active' : ''}`} />
        <span className={`first-run-step-dot ${stepIdx >= 2 ? 'is-active' : ''}`} />
        <span className={`first-run-step-dot ${stepIdx >= 3 ? 'is-active' : ''}`} />
      </div>
      <span className="first-run-step-title">
        Шаг {stepIdx} из 3 · {stepName}
      </span>
    </div>
  );
}

function WizardGoalCard({ state }: { readonly state: ReturnType<typeof useFirstRunWizardState> }) {
  return (
    <FirstRunGoalCard
      goal={state.data.goal}
      onGoalChange={state.handleGoalChange}
      isEditing={state.isGoalEditing || state.step === 'goal'}
      onStartEdit={() => {
        state.setIsGoalEditing(true);
        state.setStep('goal');
      }}
      onSaveEdit={() => {
        state.setIsGoalEditing(false);
        state.setStep('source');
      }}
    />
  );
}

function PendingStep({
  number,
  title,
  after,
}: {
  readonly number: number;
  readonly title: string;
  readonly after: number;
}) {
  return (
    <article
      className="first-run-stage-card first-run-pending-context"
      role="group"
      aria-label={title}
      aria-disabled="true"
    >
      <div className="first-run-stage-head">
        <span className="first-run-stage-badge">{number}</span>
        <h2 className="first-run-stage-title">{title}</h2>
        <small>после шага {after}</small>
      </div>
    </article>
  );
}

function CompletedSource({ state }: { readonly state: ReturnType<typeof useFirstRunWizardState> }) {
  const title = state.data.isSourceSkipped
    ? 'Источник пропущен'
    : (state.uploadedFile?.name ?? 'Источник выбран');
  return (
    <article className="first-run-stage-card is-done" aria-label="Источник">
      <div className="first-run-stage-head">
        <span className="first-run-stage-badge is-done">
          <Check size={16} aria-hidden="true" />
        </span>
        <h2 className="first-run-stage-title">Источник</h2>
        <button
          className="first-run-btn-ghost"
          type="button"
          onClick={() => state.setStep('source')}
        >
          <PencilSimple size={14} className="first-run-edit-icon" aria-hidden="true" />
          Изменить
        </button>
      </div>
      <p className="first-run-goal-text">{title}</p>
    </article>
  );
}

interface WizardMainCardsProps {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  readonly ingestionResult?: IngestedResume;
  readonly onOpenConsultant: (prompt?: string) => void;
  readonly onConnectSource?: (source: 'linkedin' | 'hh') => void;
  readonly isMobile: boolean;
  readonly fileInputRef: RefObject<HTMLInputElement>;
}

function WizardSourceStep({
  state,
  isMobile,
  fileInputRef,
  onOpenConsultant,
  onConnectSource,
}: Omit<WizardMainCardsProps, 'onComplete' | 'ingestionResult'>): ReactElement {
  return (
    <FirstRunSourceCard
      data={state.data}
      isMobile={isMobile}
      uploadedFileName={state.uploadedFile?.name}
      isIngesting={state.isIngesting}
      ingestionError={state.ingestionError}
      ingestionNotice={state.ingestionNotice}
      onSelectSource={state.handleSelectSource}
      onConnectSource={onConnectSource}
      onTriggerFileUpload={() =>
        isMobile ? state.setIsSourceMenuOpen(true) : fileInputRef.current?.click()
      }
      onTriggerConsultant={() => {
        state.handleChooseTalk();
        onOpenConsultant();
      }}
      onNext={() => state.setStep('context')}
      onSkip={() => state.setIsSkipDialogOpen(true)}
    />
  );
}

function WizardMainCards({
  state,
  onComplete,
  ingestionResult,
  onOpenConsultant,
  onConnectSource,
  isMobile,
  fileInputRef,
}: WizardMainCardsProps): ReactElement {
  return (
    <>
      <WizardGoalCard state={state} />
      {state.step === 'source' ? (
        <WizardSourceStep
          state={state}
          isMobile={isMobile}
          fileInputRef={fileInputRef}
          onOpenConsultant={onOpenConsultant}
          onConnectSource={onConnectSource}
        />
      ) : null}
      {!isMobile && state.step === 'goal' ? (
        <PendingStep number={2} title="Источник" after={1} />
      ) : null}
      {!isMobile && state.step !== 'context' ? (
        <PendingStep number={3} title="Контекст" after={2} />
      ) : null}
      {!isMobile && state.step === 'context' ? <CompletedSource state={state} /> : null}
      {state.step === 'context' ? (
        <FirstRunContextCard
          data={state.data}
          onOpenCitySheet={() => state.setIsCitySheetOpen(true)}
          cityPicker={<WizardCityPicker state={state} isMobile={isMobile} />}
          onFormatChange={state.handleFormatChange}
          onRelocationToggle={state.handleRelocationToggle}
          onSubmit={() => onComplete?.(state.data, ingestionResult)}
        />
      ) : null}
    </>
  );
}

function WizardCityPicker({
  state,
  isMobile,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly isMobile: boolean;
}) {
  return (
    <FirstRunCitySheet
      isOpen={state.isCitySheetOpen}
      isMobile={isMobile}
      selectedCity={state.data.context.city}
      onClose={() => state.setIsCitySheetOpen(false)}
      onSelectCity={state.handleSelectCity}
    />
  );
}

/** 1440: «Загрузить» сразу открывает системный выбор файла, без меню 390. */
function DesktopFileInput({
  inputRef,
  onPickFile,
}: {
  readonly inputRef: RefObject<HTMLInputElement>;
  readonly onPickFile: (file: File) => void;
}): ReactElement {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
      className="first-run-native-file-input"
      data-testid="native-file-input"
      aria-label="Файл резюме"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPickFile(file);
        event.target.value = '';
      }}
    />
  );
}

function WizardDialogs({
  state,
  ingestion,
  isMobile,
  fileInputRef,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly ingestion?: ResumeIngestionState;
  readonly isMobile: boolean;
  readonly fileInputRef: RefObject<HTMLInputElement>;
}): ReactElement {
  const pickFile = (file: File) => {
    void state.handleFileUpload(file, ingestion);
  };
  return (
    <>
      {isMobile ? null : <DesktopFileInput inputRef={fileInputRef} onPickFile={pickFile} />}
      <FirstRunSourceMenu
        isOpen={state.isSourceMenuOpen}
        onClose={() => state.setIsSourceMenuOpen(false)}
        onPickFile={pickFile}
      />
      <FirstRunSkipDialog
        isOpen={state.isSkipDialogOpen}
        onCancel={() => state.setIsSkipDialogOpen(false)}
        onConfirm={state.handleConfirmSkip}
      />
      <FirstRunSkippedToast
        isVisible={state.isSkippedToastVisible && !state.isCitySheetOpen}
        onUndo={state.handleUndoSkip}
      />
    </>
  );
}

function WizardStateNotes(props: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly partialSourcesMessage?: string | null;
  readonly importProgressLabel?: string | null;
  readonly onOpenConsultant: (prompt?: string) => void;
}): ReactElement {
  const { state } = props;
  const fileIsLong = useLongWait(state.isIngesting);
  const staleLabel = fileIsLong
    ? fileStaleLabel(state.uploadedFile?.name)
    : props.importProgressLabel;
  return (
    <>
      {staleLabel ? <FirstRunStaleLoading label={staleLabel} /> : null}
      {props.partialSourcesMessage && state.step !== 'goal' ? (
        <FirstRunPartialSources message={props.partialSourcesMessage} />
      ) : null}
      {state.step === 'context' && state.data.isSourceSkipped ? (
        <FirstRunEmptySources onConsultant={() => props.onOpenConsultant()} />
      ) : null}
    </>
  );
}

interface FirstRunScreenProps {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly partialSourcesMessage?: string | null;
  readonly importProgressLabel?: string | null;
  readonly isMobile: boolean;
  readonly hasInternalConsultant: boolean;
  readonly onComplete?: FirstRunWizardProps['onComplete'];
  readonly onOpenConsultant: FirstRunWizardProps['onOpenConsultant'];
  readonly onConnectSource?: FirstRunWizardProps['onConnectSource'];
  readonly ingestion: ResumeIngestionState;
}

function WizardBack({ state }: { readonly state: ReturnType<typeof useFirstRunWizardState> }) {
  return (
    <button
      type="button"
      className="first-run-back"
      aria-label="Назад"
      disabled={state.step === 'goal'}
      onClick={() => state.setStep(state.step === 'context' ? 'source' : 'goal')}
    >
      <CaretLeft size={20} aria-hidden="true" />
    </button>
  );
}

function FirstRunScreen(props: FirstRunScreenProps): ReactElement {
  const { state, isMobile, hasInternalConsultant, onComplete } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`first-run-screen${isMobile ? ' is-mobile' : ''}`}
      data-mobile={isMobile}
      data-step={state.step}
      data-testid="first-run-wizard"
    >
      {isMobile ? <WizardBack state={state} /> : null}
      <div className={`first-run-container${hasInternalConsultant ? '' : ' is-shell-panel'}`}>
        <main className="first-run-main">
          {!isMobile ? (
            <header className="first-run-desktop-header">
              <h1>Старт</h1>
            </header>
          ) : null}
          <StepsBar step={state.step} />
          <p className="first-run-eyebrow">
            Находка себя, шаг {state.step === 'goal' ? 1 : state.step === 'source' ? 2 : 3} из 3
          </p>
          <WizardStateNotes
            state={state}
            partialSourcesMessage={props.partialSourcesMessage}
            importProgressLabel={props.importProgressLabel}
            onOpenConsultant={props.onOpenConsultant}
          />
          <WizardMainCards
            state={state}
            onComplete={onComplete}
            ingestionResult={props.ingestion.result}
            onOpenConsultant={props.onOpenConsultant}
            onConnectSource={props.onConnectSource}
            isMobile={isMobile}
            fileInputRef={fileInputRef}
          />
        </main>
        {hasInternalConsultant ? (
          <FirstRunConsultant onOpenConsultant={props.onOpenConsultant} />
        ) : null}
      </div>
      <WizardDialogs {...{ state, isMobile, fileInputRef }} ingestion={props.ingestion} />
    </div>
  );
}

export function FirstRunWizard(props: FirstRunWizardProps): ReactElement {
  const {
    initialStep = 'goal',
    onComplete,
    onStartedChange,
    onOpenConsultant,
    onConnectSource,
    showConsultantPanel = true,
    isMobile = false,
    hasAccount = false,
    ingestion,
  } = props;
  const state = useFirstRunWizardState(initialStep);
  const ownedIngestion = useResumeIngestion(hasAccount);
  const activeIngestion = ingestion ?? ownedIngestion;
  const hasInternalConsultant = showConsultantPanel && !isMobile;
  useEffect(() => onStartedChange?.(true), [onStartedChange]);

  return (
    <FirstRunScreen
      state={state}
      partialSourcesMessage={props.partialSourcesMessage}
      importProgressLabel={props.importProgressLabel}
      isMobile={isMobile}
      hasInternalConsultant={hasInternalConsultant}
      onComplete={onComplete}
      onOpenConsultant={onOpenConsultant}
      onConnectSource={onConnectSource}
      ingestion={activeIngestion}
    />
  );
}
