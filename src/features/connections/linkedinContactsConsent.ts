import { useCallback, useEffect, useState } from 'react';
import {
  getAccountCapabilityConsents,
  grantAccountCapabilityConsent,
  revokeAccountCapabilityConsent,
  type AccountCapabilityConsentRecord,
} from '../account/accountCapabilityConsentApi';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../legal/capabilityConsents';

export interface LinkedInContactsConsentState {
  readonly granted: boolean;
  readonly busy: boolean;
  /** The last change did not save; the switch keeps the stored state. */
  readonly error?: string | null;
  readonly onToggle: () => void;
}

export function linkedInContactsConsentActive(
  records: readonly Pick<
    AccountCapabilityConsentRecord,
    'capability' | 'grantedAt' | 'revokedAt'
  >[],
): boolean {
  const latest = records
    .filter((record) => record.capability === 'linkedin_contacts')
    .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt))[0];
  return latest !== undefined && latest.revokedAt === null;
}

/**
 * B561: the «пути для других кандидатов» switch in the LinkedIn manage dialog.
 * `undefined` while loading or after a failed load, so the dialog shows no
 * switch it cannot back with the stored consent.
 */
export function useLinkedInContactsConsent(
  open: boolean,
): LinkedInContactsConsentState | undefined {
  const [granted, setGranted] = useState<boolean | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    getAccountCapabilityConsents()
      .then((records) => {
        if (current) setGranted(linkedInContactsConsentActive(records));
      })
      .catch(() => {
        if (current) setGranted(undefined);
      });
    return () => {
      current = false;
    };
  }, [open]);
  const onToggle = useCallback(() => {
    if (granted === undefined || busy) return;
    setBusy(true);
    setError(null);
    const change = granted
      ? revokeAccountCapabilityConsent('linkedin_contacts')
      : grantAccountCapabilityConsent(
          'linkedin_contacts',
          CAPABILITY_CONSENT_CURRENT_VERSION.linkedin_contacts,
        );
    change
      .then(() => setGranted(!granted))
      .catch(() => setError('Не удалось сохранить согласие. Повторите попытку.'))
      .finally(() => setBusy(false));
  }, [busy, granted]);
  if (!open || granted === undefined) return undefined;
  return { granted, busy, error, onToggle };
}
