import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { IntakeSourceStep, type IntakeSourceStepProps } from './IntakeSourceStep';
import { OnboardingSourceCards } from './OnboardingSourceCards';
import { OnboardingProgressStep } from './OnboardingProgressStep';
import { OnboardingReviewStep } from './OnboardingReviewStep';
import { OnboardingCampaignStep, OnboardingQuickStartStep } from './OnboardingCampaignStep';
import { OnboardingDoneStep } from './OnboardingDoneStep';
import { OnboardingWizardChrome } from './OnboardingWizardChrome';
import { buildParseProgressCounts } from './profileFactReviewRows';
import { formatOnboardingDuration } from './onboardingTimer';
import type { useOnboardingWizardModel } from './useOnboardingWizardModel';
import { descriptionFor, titleFor } from './onboardingWizardCopy';

type WizardModel = ReturnType<typeof useOnboardingWizardModel>;

function IntakeSourcePanel({ model }: { readonly model: WizardModel }) {
  return <IntakeSourceStep {...intakeSourceProps(model)} />;
}

function intakeSourceProps(model: WizardModel): IntakeSourceStepProps {
  return {
    hideChoiceRow: true,
    isDesktop: model.isDesktop,
    sourceChoice: model.sourceChoice,
    onChooseSource: model.actions.chooseSource,
    lock: model.sourceLock,
    onReleaseSource: model.actions.releaseSource,
    onDisconnectPlatform: (platform) => void model.actions.disconnectPlatform(platform),
    ingested: model.ingested,
    busy: model.ingestion.busy,
    notice: model.ingestion.notice,
    resumeText: model.typedResume,
    onResumeText: model.setTypedResume,
    onPickPdf: model.actions.onPickPdf,
    linkedinOpen: model.isLinkedinModalOpen,
    hhOpen: model.isHhModalOpen,
    onLinkedinOpen: model.setLinkedinModalOpen,
    onHhOpen: model.setHhModalOpen,
    onLinkedinImported: model.actions.onLinkedinImported,
    onProviderConnectionFailure: model.setError,
    onHhConnected: model.actions.onHhConnected,
    onHhAuthenticatedEmpty: model.actions.onHhAuthenticatedEmpty,
    hhConnected: model.isHhConnected || model.connectedSource?.platform === 'hh',
    hhEmptyAccount: model.isHhEmptyAccount,
    linkedinConnected:
      model.isLinkedinConnected || model.connectedSource?.platform === 'linkedin',
    connectedSource: model.connectedSource,
  };
}

function SourceChoiceActions({ model }: { readonly model: WizardModel }) {
  return (
    <>
      {model.sourceChoice === 'pdf' ? (
        <button className="career-text-button" type="button" onClick={() => model.actions.chooseSource('text')}>
          Нет PDF под рукой — вставить текст резюме
        </button>
      ) : null}
      {model.sourceChoice === 'text' ? (
        <button className="career-quiet-button" type="button" onClick={() => model.actions.chooseSource('pdf')}>
          <ArrowLeft size={16} />Вернуться к PDF
        </button>
      ) : null}
    </>
  );
}

function SourceStep({ model }: { readonly model: WizardModel }) {
  const active =
    model.sourceChoice === 'pdf' || model.sourceChoice === 'text'
      ? 'pdf'
      : model.sourceChoice === 'none'
        ? 'none'
        : 'profile-import';
  return (
    <>
      <OnboardingSourceCards
        active={active}
        linkedinSelected={
          model.isLinkedinConnected || model.connectedSource?.platform === 'linkedin' || model.isLinkedinModalOpen
        }
        hhSelected={model.isHhConnected || model.connectedSource?.platform === 'hh' || model.isHhModalOpen}
        lockedTo={model.sourceLock.lockedTo === 'text' ? 'pdf' : model.sourceLock.lockedTo}
        lockReason={model.sourceLock.reason}
        onChoosePdf={() => model.actions.chooseSource('pdf')}
        onChooseLinkedin={() => model.actions.chooseSource('profile-import')}
        onChooseHh={() => model.actions.chooseSource('profile-import')}
        onChooseTalk={() => model.actions.chooseSource('none')}
      />
      <SourceChoiceActions model={model} />
      {['pdf', 'profile-import', 'text'].includes(model.sourceChoice) ? (
        <IntakeSourcePanel model={model} />
      ) : null}
    </>
  );
}

function ProgressStep({ model }: { readonly model: WizardModel }) {
  return (
    <OnboardingProgressStep
      busy={model.ingestion.busy}
      error={model.ingestion.error}
      counts={buildParseProgressCounts({
        experience: model.ingested?.parsed.experience ?? [],
        education: model.ingested?.parsed.education ?? [],
        skills: model.ingested?.parsed.skills ?? [],
      })}
    />
  );
}

function TalkStep({ model }: { readonly model: WizardModel }) {
  return (
    <OnboardingQuickStartStep
      roleTitle={model.quickRole}
      regions={model.regions}
      format={model.format}
      onRoleChange={model.setQuickRole}
      onToggleRegion={model.actions.toggleRegion}
      onChangeFormat={model.setFormat}
    />
  );
}

function ReviewStep({ model }: { readonly model: WizardModel }) {
  return (
    <OnboardingReviewStep
      rows={model.reviewRows}
      editingId={model.reviewEditingId}
      onStartEdit={(id, title) => {
        model.setReviewEditingId(id);
        model.setReviewDraft(model.reviewOverrides[id] ?? title);
      }}
      onCancelEdit={() => model.setReviewEditingId(undefined)}
      draftValue={model.reviewDraft}
      onDraftChange={model.setReviewDraft}
      onSaveEdit={(id) => {
        model.setReviewOverrides((current) => ({ ...current, [id]: model.reviewDraft }));
        model.setReviewEditingId(undefined);
      }}
    />
  );
}

function CampaignStep({ model }: { readonly model: WizardModel }) {
  return (
    <OnboardingCampaignStep
      state={model.campaign.state}
      roles={model.campaign.roles}
      selectedRoleIds={model.campaign.selectedRoleIds}
      regions={model.regions}
      format={model.format}
      elapsedSeconds={
        model.campaign.startedAt === 0
          ? null
          : Math.max(0, Math.floor((model.now - model.campaign.startedAt) / 1000))
      }
      error={model.campaign.error}
      onToggleRole={model.campaign.toggleRole}
      onAddRole={model.campaign.addRole}
      onToggleRegion={model.actions.toggleRegion}
      onChangeFormat={model.setFormat}
    />
  );
}

function DoneStep({ model }: { readonly model: WizardModel }) {
  return (
    <OnboardingDoneStep
      roleTitle={model.selectedRoleTitle}
      durationLabel={formatOnboardingDuration(model.timer.current, model.now)}
    />
  );
}

function WizardStepContents({ model }: { readonly model: WizardModel }) {
  return (
    <>
      {model.step === 'source' ? <SourceStep model={model} /> : null}
      {model.step === 'progress' ? <ProgressStep model={model} /> : null}
      {model.step === 'talk' ? <TalkStep model={model} /> : null}
      {model.step === 'review' ? <ReviewStep model={model} /> : null}
      {model.step === 'campaign' ? <CampaignStep model={model} /> : null}
      {model.step === 'done' ? <DoneStep model={model} /> : null}
    </>
  );
}

function WizardFooter({ model }: { readonly model: WizardModel }) {
  return (
    <footer className="career-intake-actions">
      {model.step === 'source' ? (
        <span />
      ) : (
        <button className="career-quiet-button" type="button" onClick={model.actions.goBack}>
          <ArrowLeft size={18} />Назад
        </button>
      )}
      <button
        className="career-primary-button"
        type="button"
        disabled={
          (model.step === 'progress' && model.ingestion.busy) ||
          (model.step === 'campaign' && model.campaign.state === 'loading')
        }
        onClick={() => (model.step === 'done' ? model.actions.complete() : void model.actions.goNext())}
      >
        {model.step === 'done' ? 'Перейти в «Вакансии»' : 'Продолжить'}
        <ArrowRight size={18} weight="bold" />
      </button>
    </footer>
  );
}

export function OnboardingWizardView({ model }: { readonly model: WizardModel }) {
  return (
    <section
      className="career-intake career-onboarding"
      data-step={model.step}
      aria-labelledby="onboarding-title"
    >
      <OnboardingWizardChrome
        step={model.stepInfo}
        title={titleFor(model.step)}
        description={descriptionFor(model.step)}
        onSkip={() => model.props.onComplete(model.buildWorkspaceInput())}
        onSignIn={model.props.hasAccount ? undefined : model.props.onSignIn}
      />
      <WizardStepContents model={model} />
      {model.error ? (
        <p className="career-intake-error" role="alert" ref={model.errorRef}>
          {model.error}
        </p>
      ) : null}
      <WizardFooter model={model} />
    </section>
  );
}
