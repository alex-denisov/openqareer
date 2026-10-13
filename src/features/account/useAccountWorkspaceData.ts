import { useCallback, useEffect, useState } from 'react';
import { getAccount, getConnections, type AccountSnapshot, type CandidateConnection } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { getPendingAccountEmailChange } from './accountEmailChangeApi';
import type { PendingAccountEmailChange } from './accountEmailChangeApi';

export function useAccountWorkspaceData() {
  const [account, setAccount] = useState<AccountSnapshot>();
  const [connections, setConnections] = useState<CandidateConnection[]>();
  const [pendingEmailChange, setPendingEmailChange] = useState<PendingAccountEmailChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const refreshAccount = useCallback(async () => {
    const data = await loadAccountData();
    setAccount(data.account);
    setPendingEmailChange(data.pendingEmailChange);
    setConnections(data.connections);
    return data.account;
  }, []);

  useEffect(() => loadInitialAccount({
    setAccount,
    setPendingEmailChange,
    setConnections,
    setError,
    setLoading,
  }), []);
  return {
    account, setAccount, connections, setConnections, pendingEmailChange, setPendingEmailChange,
    loading, setLoading, error, setError, notice, setNotice, refreshAccount,
  };
}

async function loadAccountData() {
  const [account, pendingEmailChange] = await Promise.all([
    getAccount(),
    getPendingAccountEmailChange(),
  ]);
  const connections = await getConnections().catch(() => undefined);
  return { account, pendingEmailChange, connections };
}

function loadInitialAccount(setters: {
  readonly setAccount: (account: AccountSnapshot) => void;
  readonly setPendingEmailChange: (pending: PendingAccountEmailChange | null) => void;
  readonly setConnections: (connections?: CandidateConnection[]) => void;
  readonly setError: (error?: string) => void;
  readonly setLoading: (loading: boolean) => void;
}) {
  let active = true;
  void loadAccountData()
    .then((data) => {
      if (!active) return;
      setters.setAccount(data.account);
      setters.setPendingEmailChange(data.pendingEmailChange);
      setters.setConnections(data.connections);
      setters.setError(undefined);
    })
    .catch((reason: unknown) => {
      if (active) setters.setError(apiErrorMessage(reason, 'Не удалось загрузить настройки аккаунта.'));
    })
    .finally(() => { if (active) setters.setLoading(false); });
  return () => { active = false; };
}
