import type { ReactElement } from 'react';
import type {
  FirstRunData,
  FirstRunSpecialState,
  FirstRunStep,
} from './firstRunTypes';
import { FirstRunSourceMenu } from './FirstRunSourceMenu';
import { FirstRunCitySheet } from './FirstRunCitySheet';
import { FirstRunSkipDialog, FirstRunSkippedToast } from './FirstRunSkipDialog';
import { FirstRunConsultant } from './FirstRunConsultant';
import {
  FirstRunEmptySources,
  FirstRunErrorState,
  FirstRunPartialSourceBanner,
  FirstRunSessionExpired,
  FirstRunSkeleton,
  FirstRunStaleLoading,
} from './FirstRunStates';
import {
  FirstRunContextCard,
  FirstRunGoalCard,
  FirstRunSourceCard,
} from './FirstRunSteps';
import { useFirstRunWizardState } from './useFirstRunWizardState';

import type { IngestedResume, ResumeIngestionState } from '../journey/useResumeIngestion';

export interface FirstRunWizardProps {
  readonly initialStep?: FirstRunStep;
  readonly specialState?: FirstRunSpecialState;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  readonly onRetry?: () => void;
  readonly onSignIn?: () => void;
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

function WizardMainCards({
  state,
  onComplete,
  ingestionResult,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly onComplete?: (data: FirstRunData, ingestionResult?: IngestedResume) => void;
  readonly ingestionResult?: IngestedResume;
}): ReactElement {
  return (
    <>
      <FirstRunGoalCard
        goal={state.data.goal}
        onGoalChange={state.handleGoalChange}
        isEditing={state.isGoalEditing}
        onStartEdit={() => state.setIsGoalEditing(true)}
        onSaveEdit={() => {
          state.setIsGoalEditing(false);
          state.setStep('source');
        }}
      />
      {state.step === 'source' ? (
        <FirstRunSourceCard
          data={state.data}
          uploadedFileName={state.uploadedFile?.name}
          isIngesting={state.isIngesting}
          ingestionError={state.ingestionError}
          onSelectSource={state.handleSelectSource}
          onTriggerFileUpload={() => state.setIsSourceMenuOpen(true)}
          onTriggerConsultant={() => state.setIsMobileChatOpen(true)}
          onNext={() => state.setStep('context')}
          onSkip={() => state.setIsSkipDialogOpen(true)}
        />
      ) : null}
      {state.step === 'context' ? (
        <FirstRunContextCard
          data={state.data}
          onOpenCitySheet={() => state.setIsCitySheetOpen(true)}
          onFormatChange={state.handleFormatChange}
          onRelocationToggle={state.handleRelocationToggle}
          onSubmit={() => onComplete?.(state.data, ingestionResult)}
        />
      ) : null}
    </>
  );
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
      <FirstRunCitySheet
        isOpen={state.isCitySheetOpen}
        selectedCity={state.data.context.city}
        onClose={() => state.setIsCitySheetOpen(false)}
        onSelectCity={state.handleSelectCity}
      />
      <FirstRunSkipDialog
        isOpen={state.isSkipDialogOpen}
        onCancel={() => state.setIsSkipDialogOpen(false)}
        onConfirm={state.handleConfirmSkip}
      />
      <FirstRunSkippedToast
        isVisible={state.isSkippedToastVisible}
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

function MobileChatModal({
  isOpen,
  turns,
  onSendTurn,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly turns: readonly FirstRunConsultantTurn[];
  readonly onSendTurn: (t: string) => void;
  readonly onClose: () => void;
}): ReactElement | null {
  if (!isOpen) return null;
  return (
    <div
      className="first-run-mobile-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Диалог с консультантом"
      data-testid="first-run-mobile-chat"
    >
      <FirstRunConsultant
        turns={turns}
        onSendTurn={onSendTurn}
        isMobileChat={true}
        onBackFromMobileChat={onClose}
      />
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
    isMobile = false,
    ingestion,
  } = props;
  const state = useFirstRunWizardState(initialStep);
  const specialView = getSpecialStateView(specialState, onRetry, onSignIn);
  if (specialView) return specialView;

  return (
    <div className="first-run-screen" data-testid="first-run-wizard">
      <div className="first-run-container">
        <main className="first-run-main">
          <StepsBar step={state.step} />
          <p className="first-run-eyebrow">Находка себя</p>
          {specialState === 'partial-source' ? <FirstRunPartialSourceBanner /> : null}
          {specialState === 'empty-sources' ? (
            <FirstRunEmptySources onConsultant={() => state.setIsMobileChatOpen(true)} />
          ) : null}
          <WizardMainCards
            state={state}
            onComplete={onComplete}
            ingestionResult={ingestion?.result}
          />
        </main>
        {!isMobile ? (
          <FirstRunConsultant turns={state.turns} onSendTurn={state.handleSendTurn} />
        ) : null}
      </div>
      <MobileChatModal
        isOpen={isMobile && state.isMobileChatOpen}
        turns={state.turns}
        onSendTurn={state.handleSendTurn}
        onClose={() => state.setIsMobileChatOpen(false)}
      />
      <WizardDialogs state={state} ingestion={ingestion} />
    </div>
  );
}
