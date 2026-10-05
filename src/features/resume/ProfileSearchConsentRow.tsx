import { useEffect, useState } from 'react';
import type { SearchConsentState } from '../../../shared/searchConsent';
import { SEARCH_CONSENT_ACTIVE_TEXT, SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import { getSearchConsent, setSearchConsent } from '../vacancies/recruiterContactsApi';

export interface ProfileSearchConsentRowProps {
  readonly initialConsent?: SearchConsentState | null;
  readonly onConsentChange?: (consent: SearchConsentState) => void;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

function ConsentStatusHeader({
  granted,
  formattedDate,
  saving,
  onToggle,
}: {
  readonly granted: boolean;
  readonly formattedDate: string | null;
  readonly saving: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <div className="career-profile-screen-search-consent-header">
      <div className="career-profile-screen-search-consent-status-group">
        <span className="career-profile-screen-search-consent-title">Вы в поиске</span>
        <span
          className={`career-profile-screen-search-consent-badge ${
            granted ? 'is-granted' : 'is-disabled'
          }`}
        >
          {granted ? 'включено' : 'выключено'}
        </span>
        {formattedDate ? (
          <span className="career-profile-screen-search-consent-date">
            обновлено {formattedDate}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={`career-quiet-button career-profile-screen-search-consent-btn ${
          granted ? 'is-active' : ''
        }`}
        onClick={onToggle}
        disabled={saving}
      >
        {saving ? 'Сохраняем…' : granted ? 'Выключить' : 'Включить'}
      </button>
    </div>
  );
}

function useSearchConsentToggle(
  initialConsent?: SearchConsentState | null,
  onConsentChange?: (consent: SearchConsentState) => void,
) {
  const [consent, setConsent] = useState<SearchConsentState | null>(initialConsent ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialConsent !== undefined) {
      setConsent(initialConsent);
      return;
    }
    let active = true;
    getSearchConsent()
      .then((loaded) => {
        if (active) setConsent(loaded);
      })
      .catch(() => {
        // Оставляем дефолтное состояние при сетевой ошибке первичной загрузки
      });
    return () => {
      active = false;
    };
  }, [initialConsent]);

  const granted = Boolean(consent?.granted);
  const formattedDate = consent?.updatedAt ? formatDate(consent.updatedAt) : null;

  async function handleToggle() {
    setSaving(true);
    setError(null);
    try {
      const updated = await setSearchConsent(!granted);
      setConsent(updated);
      onConsentChange?.(updated);
    } catch {
      setError('Не удалось обновить статус поиска. Попробуйте ещё раз позже.');
    } finally {
      setSaving(false);
    }
  }

  return { granted, formattedDate, saving, error, handleToggle };
}

export function ProfileSearchConsentRow({
  initialConsent,
  onConsentChange,
}: ProfileSearchConsentRowProps) {
  const { granted, formattedDate, saving, error, handleToggle } = useSearchConsentToggle(
    initialConsent,
    onConsentChange,
  );

  return (
    <div className="career-profile-screen-search-consent" data-testid="profile-search-consent-row">
      <ConsentStatusHeader
        granted={granted}
        formattedDate={formattedDate}
        saving={saving}
        onToggle={handleToggle}
      />
      <p className="career-profile-screen-search-consent-text">
        {granted ? SEARCH_CONSENT_ACTIVE_TEXT : SEARCH_CONSENT_TEXT}
      </p>
      {error ? (
        <p className="career-profile-screen-search-consent-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
