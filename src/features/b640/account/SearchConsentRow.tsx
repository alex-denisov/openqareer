import { useState } from 'react';
import { SEARCH_CONSENT_TEXT } from '../../../../shared/searchConsent';
import { setSearchConsent } from '../../vacancies/recruiterContactsApi';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { ConsentSwitch, useAction } from './consentParts';
import { SEARCH_CONSENT_ROW } from './dataModel';
import { ErrorLine } from './parts';

interface SearchConsentRowProps {
  readonly granted: boolean;
  readonly onChanged: () => void;
}

/**
 * n05 «Вы в поиске» (B263): отзыв — переключателем, выдача — после текста согласия.
 * Хранится отдельно от согласий `me/consents`: PUT /candidate/search-consent.
 */
export function SearchConsentRow({ granted, onChanged }: SearchConsentRowProps) {
  const [asking, setAsking] = useState(false);
  const { busy, failed, run } = useAction(() => {
    setAsking(false);
    onChanged();
  });
  const save = (next: boolean) => run(() => setSearchConsent(next));
  const toggle = (checked: boolean) => (checked ? setAsking(true) : save(false));
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">{SEARCH_CONSENT_ROW.title}</span>
        <span className="set-v">{SEARCH_CONSENT_ROW.line}</span>
        {failed && !asking ? <ErrorLine text="Не сохранилось" /> : null}
      </div>
      <ConsentSwitch
        label={SEARCH_CONSENT_ROW.title}
        checked={granted}
        disabled={busy}
        onChange={toggle}
      />
      <Dialog open={asking} title={SEARCH_CONSENT_ROW.title} onClose={() => setAsking(false)}>
        <p className="c5-lead">{SEARCH_CONSENT_TEXT}</p>
        {failed ? <ErrorLine text="Согласие не сохранилось" /> : null}
        <div className="actions">
          <button
            className="btn is-primary"
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => save(true)}
          >
            <Icon name="check" />
            Дать согласие
          </button>
          <button className="btn" type="button" onClick={() => setAsking(false)}>
            Отмена
          </button>
        </div>
      </Dialog>
    </li>
  );
}
