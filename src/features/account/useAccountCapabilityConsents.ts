import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CAPABILITY_CONSENTS_APPROVED,
  CAPABILITY_CONSENT_CURRENT_VERSION,
  type CandidateCapability,
} from '../legal/capabilityConsents';
import { apiErrorMessage } from '../coach/apiClient';
import {
  getAccountCapabilityConsents,
  grantAccountCapabilityConsent,
  revokeAccountCapabilityConsent,
  type AccountCapabilityConsentRecord,
} from './accountCapabilityConsentApi';
import { DEFAULT_ACCOUNT_CONSENTS } from './accountData';
import type { AccountConsent } from './accountTypes';

const CONSENT_CAPABILITIES: Readonly<Record<string, CandidateCapability | undefined>> = {
  'cons-auto-applies': 'actions_on_behalf',
  'cons-footprint': 'digital_footprint',
  'cons-profile-data': 'profile_activity',
};

export function useAccountCapabilityConsents() {
  const [records, setRecords] = useState<readonly AccountCapabilityConsentRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await getAccountCapabilityConsents());
      setStatusMessage(null);
    } catch (reason) {
      setRecords(null);
      setStatusMessage(apiErrorMessage(reason, 'Не удалось загрузить согласия. Повторите попытку.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const consents = useMemo(
    () => mapConsentRecords(records),
    [records],
  );

  const confirmConsent = useCallback(
    (consent: AccountConsent) =>
      updateConsent(consent, records, setRecords, setBusyId, setStatusMessage),
    [records],
  );

  return {
    consents,
    loading,
    busyId,
    statusMessage,
    reload,
    confirmConsent,
  };
}

async function updateConsent(
  consent: AccountConsent,
  records: readonly AccountCapabilityConsentRecord[] | null,
  setRecords: (records: readonly AccountCapabilityConsentRecord[] | null) => void,
  setBusyId: (id: string | null) => void,
  setStatusMessage: (message: string | null) => void,
): Promise<boolean> {
  const capability = consent.capability;
  if (!capability) return explain(setStatusMessage, 'Для этого согласия пока нет подключённого управления.');
  if (records === null) return explain(setStatusMessage, 'Сначала загрузите актуальный статус согласия.');
  if (consent.status === 'unknown') return explain(setStatusMessage, 'Нет проверенных данных об этом согласии.');
  setBusyId(consent.id);
  setStatusMessage(null);
  try {
    const changed = await persistConsentChange(consent, capability, setStatusMessage);
    if (!changed) return false;
    setRecords(await getAccountCapabilityConsents());
    return true;
  } catch (reason) {
    setStatusMessage(apiErrorMessage(reason, 'Не удалось сохранить изменение согласия.'));
    return false;
  } finally {
    setBusyId(null);
  }
}

function explain(setStatusMessage: (message: string | null) => void, message: string): false {
  setStatusMessage(message);
  return false;
}

async function persistConsentChange(
  consent: AccountConsent,
  capability: CandidateCapability,
  setStatusMessage: (message: string | null) => void,
): Promise<boolean> {
  if (consent.status === 'granted') {
    await revokeAccountCapabilityConsent(capability);
    setStatusMessage('Согласие отозвано. Связанная функция остановлена.');
    return true;
  }
  if (!CAPABILITY_CONSENTS_APPROVED) {
    setStatusMessage('Текст согласия пока не утверждён. Его нельзя принять.');
    return false;
  }
  await grantAccountCapabilityConsent(capability, CAPABILITY_CONSENT_CURRENT_VERSION[capability]);
  setStatusMessage('Согласие сохранено.');
  return true;
}

function mapConsentRecords(
  records: readonly AccountCapabilityConsentRecord[] | null,
): AccountConsent[] {
  return DEFAULT_ACCOUNT_CONSENTS.map((definition) => {
    const capability = CONSENT_CAPABILITIES[definition.id];
    if (!capability || records === null) {
      return {
        ...definition,
        date: '',
        capability,
        status: 'unknown',
        grantable: false,
        revokeable: false,
      };
    }
    const latest = [...records]
      .filter((record) => record.capability === capability)
      .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt))[0];
    const active = latest && latest.revokedAt === null;
    return {
      ...definition,
      date: active ? consentDate(latest.grantedAt) : '',
      capability,
      status: active ? 'granted' : 'not-granted',
      grantable: CAPABILITY_CONSENTS_APPROVED,
      revokeable: Boolean(active),
    };
  });
}

function consentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}
