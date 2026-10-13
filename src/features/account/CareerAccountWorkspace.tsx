import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { createAccountWorkspaceActions } from './accountWorkspaceActions';
import { CareerAccountView } from './CareerAccountView';
import { useAccountWorkspaceData } from './useAccountWorkspaceData';
import type { AccountSection, AccountSectionId } from './accountTypes';

interface CareerAccountWorkspaceProps {
  readonly initialUser: AuthUser;
  readonly initialSection: AccountSection;
  readonly onClose: () => void;
  readonly onIdentityChange: (session: AuthUser | null) => void;
  readonly onSessionUpdate: (session: AuthUser) => void;
  readonly onDataChanged?: () => void;
  readonly onOpenTariffs?: () => void;
}

export function CareerAccountWorkspace(props: CareerAccountWorkspaceProps) {
  const state = useAccountWorkspaceData();
  const identity = useAccountIdentity(props.initialUser, props.onSessionUpdate);
  const isMobile = useAccountViewport();
  const [busy, setBusy] = useState(false);
  const runAction = useAccountActionRunner(state.setError, state.setNotice, setBusy);
  const actions = createAccountWorkspaceActions({
    runAction,
    user: identity.user,
    applyIdentity: identity.applyIdentity,
    refreshAccount: state.refreshAccount,
    setAccount: state.setAccount,
    setPendingEmailChange: state.setPendingEmailChange,
    setNotice: state.setNotice,
    setError: state.setError,
    setLoading: state.setLoading,
    onIdentityChange: props.onIdentityChange,
    onClose: props.onClose,
  });
  return (
    <CareerAccountView
      user={identity.user}
      account={state.account}
      connections={state.connections}
      onConnectionsChange={state.setConnections}
      loading={state.loading}
      busy={busy}
      error={state.error}
      notice={state.notice}
      pendingEmailChange={state.pendingEmailChange}
      initialSection={sectionForView(props.initialSection)}
      isDesktopApp={isTauriEnvironment()}
      isMobile={isMobile}
      onClose={props.onClose}
      onDataChanged={props.onDataChanged}
      onOpenTariffs={props.onOpenTariffs}
      actions={actions}
    />
  );
}

function useAccountIdentity(initialUser: AuthUser, onSessionUpdate: (session: AuthUser) => void) {
  const [user, setUser] = useState(initialUser);
  useEffect(() => setUser(initialUser), [initialUser]);
  const applyIdentity = useCallback((updated: AuthUser) => {
    setUser(updated);
    onSessionUpdate(updated);
  }, [onSessionUpdate]);
  return { user, applyIdentity };
}

function useAccountViewport() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return isMobile;
}

function useAccountActionRunner(
  setError: (error?: string) => void,
  setNotice: (notice?: string) => void,
  setBusy: (busy: boolean) => void,
) {
  return useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      return await operation();
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось выполнить действие. Попробуйте ещё раз.'));
      throw reason;
    } finally {
      setBusy(false);
    }
  }, [setBusy, setError, setNotice]);
}

function sectionForView(section: AccountSection): AccountSectionId {
  if (section === 'security') return 'prof';
  if (section === 'connections') return 'conn';
  if (section === 'data') return 'cons';
  return section;
}
