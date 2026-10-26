import { useEffect, useState } from 'react';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { usePageTitleOverride } from '../shell/pageTitleOverride';
import { PushConsultantContext } from '../shell/PushConsultantButton';
import { RelocationConsentGate } from './RelocationConsentGate';
import { RelocationDesktopWorkspace } from './RelocationDesktopWorkspace';
import { RelocationMobileWorkspace } from './RelocationMobileWorkspace';
import { RelocationScreenState } from './RelocationScreenState';
import { mergeProfileFacts } from './relocationProfileFacts';
import { useRelocationSnapshot } from './useRelocationSnapshot';
import { useRelocationWorkspace, type RelocationWorkspaceInput } from './useRelocationWorkspace';
import './RelocationScreen.css';
import './RelocationForms.css';
import './RelocationMobile.css';
import './relocation-mockup.css';
import './relocation-mockup-form.css';
import './relocation-mockup-390.css';

export interface RelocationScreenProps {
  /** Back to where the candidate came from: «Карьера» (roles) or «Профиль». */
  readonly onNavigateBack: () => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenVacancies?: () => void;
}

const MOBILE_QUERY = '(max-width: 760px)';

/** 390 is its own layout (push screens and sheets), not the desktop squeezed. */
export function useRelocationMobileLayout(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE_QUERY);
    if (!query) return undefined;
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

/**
 * The «Страны и релокация» screen (mockup 15). One entry point for «Карьера»
 * and «Профиль»: without consent it shows the switched-off state and never
 * turns the section on by itself.
 */
export function RelocationScreen(props: RelocationScreenProps) {
  const state = useRelocationSnapshot();
  const mobile = useRelocationMobileLayout();
  const [justGranted, setJustGranted] = useState(false);
  usePageTitleOverride('Страны и релокация');
  if (state.loading)
    return <RelocationScreenState busy message="Загружаем сведения о странах и согласии…" />;
  if (state.error)
    return <RelocationScreenState message={state.error} onRetry={() => void state.reload()} />;
  if (!state.snapshot?.consent.granted) {
    return (
      <RelocationConsentGate
        consentStatus={state.snapshot?.consent.status === 'revoked' ? 'revoked' : 'not_granted'}
        consentTextStatus={state.snapshot?.consentTextStatus ?? 'pending_dpo_review'}
        mobile={mobile}
        onNavigateBack={props.onNavigateBack}
        onConsentGranted={(consent) => {
          setJustGranted(true);
          state.updateGrantedConsent(consent);
        }}
      />
    );
  }
  const snapshot = {
    ...state.snapshot,
    profile: mergeProfileFacts(
      state.snapshot.profile ?? emptyRelocationQuestionnaire(),
      state.snapshot.profileDraft,
    ),
  };
  return (
    <RelocationWorkspace
      {...props}
      mobile={mobile}
      input={{ snapshot, startInQuestionnaire: justGranted, onProfileUpdated: state.updateProfile }}
      onProfileUpdated={state.updateProfile}
      onConsentRevoked={state.updateConsent}
    />
  );
}

export interface RelocationWorkspaceProps extends RelocationScreenProps {
  readonly mobile: boolean;
  readonly input: RelocationWorkspaceInput;
  readonly onProfileUpdated: ReturnType<typeof useRelocationSnapshot>['updateProfile'];
  readonly onConsentRevoked: ReturnType<typeof useRelocationSnapshot>['updateConsent'];
}

function RelocationWorkspace(props: RelocationWorkspaceProps) {
  const workspace = useRelocationWorkspace(props.input);
  return props.mobile ? (
    <PushConsultantContext.Provider value={props.onOpenExpert ?? null}>
      <RelocationMobileWorkspace {...props} workspace={workspace} />
    </PushConsultantContext.Provider>
  ) : (
    <RelocationDesktopWorkspace {...props} workspace={workspace} />
  );
}
