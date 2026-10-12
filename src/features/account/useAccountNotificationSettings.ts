import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AccountNotificationEvent } from './accountTypes';
import {
  disconnectTelegram,
  getNotificationChannelStatus,
  getNotificationPreferences,
  startTelegramLink,
  updateNotificationPreference,
  type NotificationChannelStatus,
  type NotificationPreferenceKey,
} from './notificationPreferencesApi';
import { DEFAULT_NOTIFICATION_EVENTS } from './accountData';

export function useAccountNotificationSettings() {
  const [events, setEvents] = useState<readonly AccountNotificationEvent[]>(
    DEFAULT_NOTIFICATION_EVENTS,
  );
  const [channelStatus, setChannelStatus] = useState<NotificationChannelStatus | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const refresh = useNotificationSettingsRefresh(
    setEvents,
    setChannelStatus,
    setSettingsReady,
    setStatusMessage,
  );
  const update = useSaveNotificationPreference(events, setEvents, setSavingKey, setStatusMessage);
  const connect = useCreateTelegramLink(setStartUrl, setStatusMessage);
  const disconnect = useDisconnectTelegram(refresh, setStartUrl, setStatusMessage);
  const check = useCheckTelegramConnection(setChannelStatus, setStartUrl, setStatusMessage);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    events,
    emailAvailable: channelStatus?.emailAvailable ?? false,
    securitySourceAvailable: channelStatus?.mandatory.security.sourceAvailable ?? false,
    telegramAvailable: channelStatus?.telegram.available ?? false,
    telegramConnected: channelStatus?.telegram.connected ?? false,
    billingSourceAvailable: channelStatus?.mandatory.payments.sourceAvailable ?? false,
    settingsReady,
    savingKey,
    statusMessage,
    startUrl,
    onPreferenceChange: update,
    onStartTelegramLink: connect,
    onDisconnectTelegram: disconnect,
    onRefreshChannels: check,
    onReload: refresh,
  };
}

function useNotificationSettingsRefresh(
  setEvents: Dispatch<SetStateAction<readonly AccountNotificationEvent[]>>,
  setChannelStatus: Dispatch<SetStateAction<NotificationChannelStatus | null>>,
  setSettingsReady: Dispatch<SetStateAction<boolean>>,
  setStatusMessage: Dispatch<SetStateAction<string | null>>,
) {
  return useCallback(async () => {
    setSettingsReady(false);
    try {
      const [preferences, channels] = await Promise.all([
        getNotificationPreferences(),
        getNotificationChannelStatus(),
      ]);
      setEvents((current) =>
        current.map((event) => {
          const preference = preferences.find((item) => item.key === event.id);
          return preference
            ? {
                ...event,
                app: preference.app,
                email: preference.email,
                telegram: preference.telegram,
              }
            : event;
        }),
      );
      setChannelStatus(channels);
      setStatusMessage(null);
      setSettingsReady(true);
    } catch {
      setStatusMessage('Настройки временно недоступны. Попробуйте загрузить их снова.');
    }
  }, [setChannelStatus, setEvents, setSettingsReady, setStatusMessage]);
}

function useSaveNotificationPreference(
  events: readonly AccountNotificationEvent[],
  setEvents: Dispatch<SetStateAction<readonly AccountNotificationEvent[]>>,
  setSavingKey: Dispatch<SetStateAction<string | null>>,
  setStatusMessage: Dispatch<SetStateAction<string | null>>,
) {
  return useCallback(
    async (eventId: string, channel: 'app' | 'email' | 'telegram', enabled: boolean) => {
      const preferenceKey = eventId as NotificationPreferenceKey;
      const previous = events;
      const next = events.map((event) =>
        event.id === eventId ? { ...event, [channel]: enabled } : event,
      );
      const updated = next.find((event) => event.id === eventId);
      if (!updated) return;
      setEvents(next);
      setSavingKey(`${eventId}:${channel}`);
      try {
        const saved = await updateNotificationPreference(preferenceKey, {
          app: updated.app,
          email: updated.email,
          telegram: updated.telegram,
        });
        setEvents((current) =>
          current.map((event) =>
            event.id === eventId
              ? { ...event, app: saved.app, email: saved.email, telegram: saved.telegram }
              : event,
          ),
        );
        setStatusMessage('Настройки сохранены.');
      } catch {
        setEvents(previous);
        setStatusMessage('Не удалось сохранить настройку. Попробуйте ещё раз.');
      } finally {
        setSavingKey(null);
      }
    },
    [events, setEvents, setSavingKey, setStatusMessage],
  );
}

function useCreateTelegramLink(
  setStartUrl: Dispatch<SetStateAction<string | null>>,
  setStatusMessage: Dispatch<SetStateAction<string | null>>,
) {
  return useCallback(async () => {
    try {
      const link = await startTelegramLink();
      setStartUrl(link.startUrl);
      setStatusMessage('Откройте бота и нажмите Start, затем проверьте подключение.');
    } catch {
      setStatusMessage('Не удалось создать ссылку Telegram. Проверьте настройки бота.');
    }
  }, [setStartUrl, setStatusMessage]);
}

function useDisconnectTelegram(
  refresh: () => Promise<void>,
  setStartUrl: Dispatch<SetStateAction<string | null>>,
  setStatusMessage: Dispatch<SetStateAction<string | null>>,
) {
  return useCallback(async () => {
    try {
      await disconnectTelegram();
      setStartUrl(null);
      await refresh();
      setStatusMessage('Telegram отключён.');
    } catch {
      setStatusMessage('Не удалось отключить Telegram. Попробуйте ещё раз.');
    }
  }, [refresh, setStartUrl, setStatusMessage]);
}

function useCheckTelegramConnection(
  setChannelStatus: Dispatch<SetStateAction<NotificationChannelStatus | null>>,
  setStartUrl: Dispatch<SetStateAction<string | null>>,
  setStatusMessage: Dispatch<SetStateAction<string | null>>,
) {
  return useCallback(async () => {
    try {
      const status = await getNotificationChannelStatus();
      setChannelStatus(status);
      const message = !status.telegram.available
        ? 'Сервер пока не подтвердил настройку webhook Telegram.'
        : status.telegram.connected
          ? 'Telegram подключён.'
          : 'Telegram пока не подключён. Откройте бота и нажмите Start.';
      setStatusMessage(message);
      if (status.telegram.connected) setStartUrl(null);
    } catch {
      setStatusMessage('Не удалось проверить подключение Telegram.');
    }
  }, [setChannelStatus, setStartUrl, setStatusMessage]);
}
