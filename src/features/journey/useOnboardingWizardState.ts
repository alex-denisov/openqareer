import { useEffect, useRef, useState } from 'react';
import type { CandidateRegion } from '../workspace/candidateRegions';
import type { ConnectedProfileSource } from './connectedProfileSource';
import { getConnections } from '../coach/coachApi';
import { connectedProfileSource } from './connectedProfileSource';
import type { OnboardingFormat } from './onboardingFormat';
import { ONBOARDING_FORMAT_OPTIONS } from './onboardingFormat';
import type { SourceChoice } from './IntakeSourceStep';
import type { OnboardingStepId } from './onboardingWizardSteps';
import { startOnboardingTimer } from './onboardingTimer';

export function useWizardStepState(onStartedChange?: (started: boolean) => void) {
  const [step, setStep] = useState<OnboardingStepId>('source');
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (step !== 'source') onStartedChange?.(true);
  }, [step, onStartedChange]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [error]);

  return { step, setStep, error, setError, errorRef };
}

export function useWizardSourceState(
  isDesktop: boolean,
  hasAccount: boolean,
  ingested: unknown,
) {
  const [choice, setChoice] = useState<SourceChoice>(() => (isDesktop ? 'profile-import' : 'pdf'));
  const [isLinkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setHhModalOpen] = useState(false);
  const [isHhConnected, setHhConnected] = useState(false);
  const [isHhEmptyAccount, setHhEmptyAccount] = useState(false);
  const [isLinkedinConnected, setLinkedinConnected] = useState(false);
  const [connectedSource, setConnectedSource] = useState<ConnectedProfileSource>();

  useEffect(() => {
    if (!hasAccount || choice !== 'profile-import' || ingested) return;
    let active = true;
    void getConnections()
      .then((connections) => {
        if (!active) return;
        const snapshot = connectedProfileSource(connections);
        if (snapshot) setConnectedSource(snapshot);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hasAccount, choice, ingested]);

  return {
    sourceChoice: choice,
    setSourceChoice: setChoice,
    isLinkedinModalOpen,
    setLinkedinModalOpen,
    isHhModalOpen,
    setHhModalOpen,
    isHhConnected,
    setHhConnected,
    isHhEmptyAccount,
    setHhEmptyAccount,
    isLinkedinConnected,
    setLinkedinConnected,
    connectedSource,
    setConnectedSource,
  };
}

export function useWizardProfileInputState() {
  const [typedResume, setTypedResume] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [quickRole, setQuickRole] = useState('');
  const [regions, setRegions] = useState<readonly CandidateRegion[]>([]);
  const [format, setFormat] = useState<OnboardingFormat>(ONBOARDING_FORMAT_OPTIONS[0]);
  return {
    typedResume,
    setTypedResume,
    linkedinUrl,
    setLinkedinUrl,
    hhUrl,
    setHhUrl,
    quickRole,
    setQuickRole,
    regions,
    setRegions,
    format,
    setFormat,
  };
}

export function useWizardReviewState() {
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, string>>({});
  const [reviewEditingId, setReviewEditingId] = useState<string>();
  const [reviewDraft, setReviewDraft] = useState('');
  return {
    reviewOverrides,
    setReviewOverrides,
    reviewEditingId,
    setReviewEditingId,
    reviewDraft,
    setReviewDraft,
  };
}

export function useWizardClock(step: OnboardingStepId, campaignState: string) {
  const timer = useRef(startOnboardingTimer());
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (step !== 'done' && !(step === 'campaign' && campaignState === 'loading')) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, campaignState]);

  return { timer, now };
}
