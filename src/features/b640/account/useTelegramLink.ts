import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { disconnectTelegram, startTelegramLink } from '../../account/notificationPreferencesApi';
import { getTelegramLinkState, type TelegramServerState } from './telegramStateApi';

/** Привязка Telegram: нет, ждём подтверждения в боте, ссылка устарела, подключён. */
export type TelegramLinkState =
  | { readonly step: 'idle' }
  | { readonly step: 'waiting'; readonly startUrl: string; readonly expiresAt: number }
  | { readonly step: 'expired' }
  | { readonly step: 'connected'; readonly username: string | null };

export interface TelegramLink {
  readonly state: TelegramLinkState;
  readonly busy: boolean;
  readonly failed: boolean;
  /** Получить ссылку на бота (и новую, если прежняя устарела). */
  readonly start: () => void;
  readonly unlink: () => void;
}

const POLL_MS = 3000;

/** Ссылка на бота из ответа сервера: в `href` идёт только адрес `https://`. */
export function safeBotUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Состояние с сервера поверх локального: подключён с именем или ссылка устарела. */
function fromServer(server: TelegramServerState | null): TelegramLinkState | null {
  if (server?.state === 'connected') return { step: 'connected', username: server.username };
  if (server?.state === 'expired') return { step: 'expired' };
  return null;
}

/** Пока ждём подтверждения, состояние перечитывается; срок ссылки сверяется с часами. */
function useConfirmation(state: TelegramLinkState, onChange: (next: TelegramLinkState) => void) {
  useEffect(() => {
    if (state.step !== 'waiting') return undefined;
    let active = true;
    const check = async () => {
      if (Date.now() >= state.expiresAt) return onChange({ step: 'expired' });
      const next = fromServer(await getTelegramLinkState().catch(() => null));
      // Ответ мог прийти после отвязки или ухода с экрана.
      if (active && next) onChange(next);
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state, onChange]);
}

/** При открытии экрана: имя подключённого и устаревшая ссылка видны и после перезагрузки. */
function useServerState(setOwn: Dispatch<SetStateAction<TelegramLinkState | null>>) {
  useEffect(() => {
    let active = true;
    getTelegramLinkState()
      .then((server) => {
        const next = fromServer(server);
        // Кандидат мог уже нажать «Подключить»: его действие главнее прочитанного.
        if (active && next) setOwn((current) => current ?? next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [setOwn]);
}

export function useTelegramLink(connected: boolean, onConnectionChange: () => void): TelegramLink {
  const [own, setOwn] = useState<TelegramLinkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const state: TelegramLinkState = own ?? (connected ? { step: 'connected', username: null } : { step: 'idle' });
  useServerState(setOwn);

  const change = useCallback(
    (next: TelegramLinkState) => {
      setOwn(next);
      if (next.step === 'connected' || next.step === 'idle') onConnectionChange();
    },
    [onConnectionChange],
  );
  useConfirmation(state, change);

  const run = useCallback(async (action: () => Promise<TelegramLinkState>) => {
    setBusy(true);
    setFailed(false);
    try {
      change(await action());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [change]);

  const start = useCallback(
    () =>
      void run(async () => {
        const link = await startTelegramLink();
        const startUrl = safeBotUrl(link.startUrl);
        const expiresAt = Date.parse(link.expiresAt);
        // Срок не разобран — ссылку считаем устаревшей, а не вечной.
        if (!startUrl || !Number.isFinite(expiresAt)) return { step: 'expired' };
        return { step: 'waiting', startUrl, expiresAt };
      }),
    [run],
  );
  const unlink = useCallback(
    () =>
      void run(async () => {
        await disconnectTelegram();
        return { step: 'idle' };
      }),
    [run],
  );
  return { state, busy, failed, start, unlink };
}
