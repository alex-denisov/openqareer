import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  closeRemoteLogin,
  sendRemoteLoginInput,
  type RemoteLoginInput,
} from './linkedinRemoteLoginApi';
import { remoteLoginErrorText } from './remoteLoginModel';

interface ActionsInput {
  readonly accountId: string;
  readonly loginId: string;
  readonly ended: boolean;
  readonly onClose: (error?: string) => void;
}

/** Ввод на страницу и закрытие окна: Escape, кнопка и уход с экрана шлют DELETE один раз. */
export function useRemoteLoginActions({ accountId, loginId, ended, onClose }: ActionsInput) {
  const [inputError, setInputError] = useState<string>();
  const finishedRef = useRef(false);
  const aliveRef = useRef(true);

  const close = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    let failure: string | undefined;
    if (!ended) {
      try {
        await closeRemoteLogin(accountId, loginId);
      } catch (reason: unknown) {
        failure = remoteLoginErrorText(reason);
      }
    }
    onClose(failure);
  }, [accountId, loginId, ended, onClose]);

  useEscapeLayer(() => void close());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // Отложено, чтобы повторная установка в StrictMode не закрывала живое окно.
      setTimeout(() => {
        if (aliveRef.current || finishedRef.current) return;
        finishedRef.current = true;
        void closeRemoteLogin(accountId, loginId).catch(() => undefined);
      }, 0);
    };
  }, [accountId, loginId]);

  const send = useCallback(
    async (input: RemoteLoginInput) => {
      setInputError(undefined);
      try {
        await sendRemoteLoginInput(accountId, loginId, input);
      } catch (reason: unknown) {
        setInputError(remoteLoginErrorText(reason));
      }
    },
    [accountId, loginId],
  );

  return { close, send, inputError };
}
