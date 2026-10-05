import { useCallback, useState } from 'react';
import { startRemoteLogin } from './linkedinRemoteLoginApi';
import { remoteLoginErrorText } from './remoteLoginModel';

export interface RemoteLoginTarget {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly loginId: string;
}

/** Открывает вход в браузере сервера; POST выполняется по клику, а не в эффекте. */
export function useRemoteLoginLauncher(
  onError: (message: string | undefined) => void,
  onFinished: () => void,
) {
  const [target, setTarget] = useState<RemoteLoginTarget>();
  const [startingAccountId, setStartingAccountId] = useState<string>();

  const open = useCallback(
    async (accountId: string, accountLabel: string) => {
      if (target || startingAccountId) return;
      setStartingAccountId(accountId);
      onError(undefined);
      try {
        const loginId = await startRemoteLogin(accountId);
        setTarget({ accountId, accountLabel, loginId });
      } catch (reason: unknown) {
        onError(remoteLoginErrorText(reason));
      } finally {
        setStartingAccountId(undefined);
      }
    },
    [target, startingAccountId, onError],
  );

  const close = useCallback(
    (error?: string) => {
      setTarget(undefined);
      if (error) onError(error);
      onFinished();
    },
    [onError, onFinished],
  );

  return { target, startingAccountId, open, close };
}
