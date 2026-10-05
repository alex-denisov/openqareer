import { useEffect, useState } from 'react';
import { fetchRemoteLoginFrame, type RemoteLoginFrame } from './linkedinRemoteLoginApi';
import { isRemoteLoginGone, remoteLoginErrorText } from './remoteLoginModel';

export const REMOTE_LOGIN_POLL_MS = 330;

export interface RemoteLoginFrameState {
  readonly frame: RemoteLoginFrame | undefined;
  readonly error: string | undefined;
  /** Кадры больше не придут: окно закрыто или сервер его не знает. */
  readonly ended: boolean;
}

/** Опрашивает кадр ~3 раза в секунду, пока окно открыто; запросы не накладываются. */
export function useRemoteLoginFrame(accountId: string, loginId: string): RemoteLoginFrameState {
  const [frame, setFrame] = useState<RemoteLoginFrame>();
  const [error, setError] = useState<string>();
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await fetchRemoteLoginFrame(accountId, loginId, controller.signal);
        if (controller.signal.aborted) return;
        setFrame(next);
        setError(undefined);
        if (next.state === 'closed') return;
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setError(remoteLoginErrorText(reason));
        if (isRemoteLoginGone(reason)) {
          setGone(true);
          return;
        }
      }
      timer = setTimeout(() => void tick(), REMOTE_LOGIN_POLL_MS);
    };
    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [accountId, loginId]);

  return { frame, error, ended: gone || frame?.state === 'closed' };
}
