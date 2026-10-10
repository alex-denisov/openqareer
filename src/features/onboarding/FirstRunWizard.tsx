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

export interface FirstRunWizardProps {
  readonly initialStep?: FirstRunStep;
  readonly specialState?: FirstRunSpecialState;
  readonly onComplete?: (data: FirstRunData) => void;
  readonly onRetry?: () => void;
  readonly onSignIn?: () => void;
  readonly isMobile?: boolean;
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
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
  readonly onComplete?: (data: FirstRunData) => void;
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
          onSubmit={() => onComplete?.(state.data)}
        />
      ) : null}
    </>
  );
}

function WizardDialogs({
  state,
}: {
  readonly state: ReturnType<typeof useFirstRunWizardState>;
}): ReactElement {
  return (
    <>
      <FirstRunSourceMenu
        isOpen={state.isSourceMenuOpen}
        onClose={() => state.setIsSourceMenuOpen(false)}
        onPickFile={(file) => {
          state.handleSelectSource('file');
          state.handleSendTurn(`Загружен файл: ${file.name}`, true);
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

export function FirstRunWizard(props: FirstRunWizardProps): ReactElement {
  const {
    initialStep = 'source',
    specialState = 'normal',
    onComplete,
    onRetry,
    onSignIn,
    isMobile = false,
  } = props;

  const state = useFirstRunWizardState(initialStep);

  if (specialState === 'skeleton') return <FirstRunSkeleton />;
  if (specialState === 'stale-loading') return <FirstRunStaleLoading />;
  if (specialState === 'error') return <FirstRunErrorState onRetry={onRetry} />;
  if (specialState === 'session-expired') return <FirstRunSessionExpired onSignIn={onSignIn} />;

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
          <WizardMainCards state={state} onComplete={onComplete} />
        </main>
        {!isMobile ? (
          <FirstRunConsultant turns={state.turns} onSendTurn={state.handleSendTurn} />
        ) : null}
      </div>
      <WizardDialogs state={state} />
    </div>
  );
}
