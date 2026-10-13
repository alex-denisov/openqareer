import { useEffect, type ReactElement } from 'react';
import type { FirstRunData, FirstRunSpecialState, FirstRunStep } from './firstRunTypes';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';
import { FirstRunConsultant } from './FirstRunConsultant';
import {
  FirstRunEmptySources,
  FirstRunErrorState,
  FirstRunSessionExpired,
  FirstRunSkeleton,
  FirstRunStaleLoading,
} from './FirstRunStates';
import { FirstRunContextCard, FirstRunGoalCard, FirstRunSourceCard } from './FirstRunSteps';
import { useFirstRunWizardState } from './useFirstRunWizardState';
import { useResumeIngestion } from '../journey/useResumeIngestion';
import type { IngestedResume, ResumeIngestionState } from '../journey/useResumeIngestion';

export interface FirstRunWizardProps {
  readonly initialStep?: FirstRunStep;
  readonly specialState?: FirstRunSpecialState;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  readonly onRetry?: () => void;
  readonly onSignIn?: () => void;
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
      isEditing={state.isGoalEditing}
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

function WizardMainCards({
  state,
  onComplete,
  ingestionResult,
  onOpenConsultant,
  onConnectSource,
  isMobile,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  readonly ingestionResult?: IngestedResume;
  readonly onOpenConsultant: (prompt?: string) => void;
  readonly onConnectSource?: (source: 'linkedin' | 'hh') => void;
  readonly isMobile: boolean;
}): ReactElement {
  return (
    <>
      <WizardGoalCard state={state} />
      {state.step === 'source' ? (
        <FirstRunSourceCard
          data={state.data}
          uploadedFileName={state.uploadedFile?.name}
          isIngesting={state.isIngesting}
          ingestionError={state.ingestionError}
          ingestionNotice={state.ingestionNotice}
          onSelectSource={state.handleSelectSource}
          onConnectSource={onConnectSource}
          onTriggerFileUpload={() => state.setIsSourceMenuOpen(true)}
          onTriggerConsultant={onOpenConsultant}
          onNext={() => state.setStep('context')}
          onSkip={() => state.setIsSkipDialogOpen(true)}
        />
      ) : null}
      {state.step === 'context' ? (
        <FirstRunContextCard
          data={state.data}
          onOpenCitySheet={() => state.setIsCitySheetOpen(true)}
          cityPicker={
            <WizardCityPicker state={state} isMobile={isMobile} />
          }
          onFormatChange={state.handleFormatChange}
          onRelocationToggle={state.handleRelocationToggle}
          onSubmit={() => onComplete?.(state.data, ingestionResult)}
        />
      ) : null}
    </>
  );
}

function WizardCityPicker({ state, isMobile }: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly isMobile: boolean;
}) {
  return <FirstRunCitySheet
    isOpen={state.isCitySheetOpen}
    isMobile={isMobile}
    selectedCity={state.data.context.city}
    onClose={() => state.setIsCitySheetOpen(false)}
    onSelectCity={state.handleSelectCity}
  />;
}

function WizardDialogs({
  state,
  ingestion,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly ingestion?: ResumeIngestionState;
}): ReactElement {
  return (
    <>
      <FirstRunSourceMenu
        isOpen={state.isSourceMenuOpen}
        onClose={() => state.setIsSourceMenuOpen(false)}
        onPickFile={(file) => {
          void state.handleFileUpload(file, ingestion);
        }}
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

function getSpecialStateView(
  specialState: FirstRunSpecialState,
  onRetry?: () => void,
  onSignIn?: () => void,
): ReactElement | null {
  if (specialState === 'skeleton') return <FirstRunSkeleton />;
  if (specialState === 'stale-loading') return <FirstRunStaleLoading />;
  if (specialState === 'error') return <FirstRunErrorState onRetry={onRetry} />;
  if (specialState === 'session-expired') return <FirstRunSessionExpired onSignIn={onSignIn} />;
  return null;
}

interface FirstRunScreenProps {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly specialState: FirstRunSpecialState;
  readonly isMobile: boolean;
  readonly hasInternalConsultant: boolean;
  readonly onComplete?: FirstRunWizardProps['onComplete'];
  readonly onOpenConsultant: FirstRunWizardProps['onOpenConsultant'];
  readonly onConnectSource?: FirstRunWizardProps['onConnectSource'];
  readonly ingestion: ResumeIngestionState;
}

function FirstRunScreen(props: FirstRunScreenProps): ReactElement {
  const { state, specialState, isMobile, hasInternalConsultant, onComplete } = props;
  return (
    <div
      className={`first-run-screen${isMobile ? ' is-mobile' : ''}`}
      data-mobile={isMobile}
      data-testid="first-run-wizard"
    >
      <div className={`first-run-container${hasInternalConsultant ? '' : ' is-shell-panel'}`}>
        <main className="first-run-main">
          {!isMobile ? (
            <header className="first-run-desktop-header">
              <h1>Старт</h1>
            </header>
          ) : null}
          <StepsBar step={state.step} />
          <p className="first-run-eyebrow">Находка себя</p>
          {specialState === 'empty-sources' ? (
            <FirstRunEmptySources onConsultant={props.onOpenConsultant} />
          ) : null}
          <WizardMainCards
            state={state}
            onComplete={onComplete}
            ingestionResult={props.ingestion.result}
            onOpenConsultant={props.onOpenConsultant}
            onConnectSource={props.onConnectSource}
            isMobile={isMobile}
          />
        </main>
        {hasInternalConsultant ? (
          <FirstRunConsultant onOpenConsultant={props.onOpenConsultant} />
        ) : null}
      </div>
      <WizardDialogs state={state} ingestion={props.ingestion} />
    </div>
  );
}

export function FirstRunWizard(props: FirstRunWizardProps): ReactElement {
  const {
    initialStep = 'source',
    specialState = 'normal',
    onComplete,
    onRetry,
    onSignIn,
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
  const specialView = getSpecialStateView(specialState, onRetry, onSignIn);
  if (specialView) return specialView;

  return (
    <FirstRunScreen
      state={state}
      specialState={specialState}
      isMobile={isMobile}
      hasInternalConsultant={hasInternalConsultant}
      onComplete={onComplete}
      onOpenConsultant={onOpenConsultant}
      onConnectSource={onConnectSource}
      ingestion={activeIngestion}
    />
  );
}
