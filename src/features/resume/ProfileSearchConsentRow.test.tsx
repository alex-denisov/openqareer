import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SEARCH_CONSENT_ACTIVE_TEXT, SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import { ProfileSearchConsentRow } from './ProfileSearchConsentRow';

describe('ProfileSearchConsentRow (C64)', () => {
  it('отображает статус «выключено», константный текст и кнопку «Включить» при granted: false', () => {
    const html = renderToStaticMarkup(
      <ProfileSearchConsentRow
        initialConsent={{
          granted: false,
          policyVersion: 'search-consent-2026-09-27',
          updatedAt: '',
        }}
      />,
    );
    expect(html).toContain('Вы в поиске');
    expect(html).toContain('выключено');
    expect(html).toContain('is-disabled');
    expect(html).toContain(SEARCH_CONSENT_TEXT);
    expect(html).toContain('Включить');
    expect(html).not.toContain('is-granted');
  });

  it('отображает статус «включено», форматированную дату и кнопку «Выключить» при granted: true', () => {
    const html = renderToStaticMarkup(
      <ProfileSearchConsentRow
        initialConsent={{
          granted: true,
          policyVersion: 'search-consent-2026-09-27',
          updatedAt: '2026-09-27T14:30:00.000Z',
        }}
      />,
    );
    expect(html).toContain('Вы в поиске');
    expect(html).toContain('включено');
    expect(html).toContain('is-granted');
    expect(html).toContain('обновлено 27 сентября 2026');
    // B333: включённый режим не просит «включите режим».
    expect(html).toContain(SEARCH_CONSENT_ACTIVE_TEXT);
    expect(html).not.toContain(SEARCH_CONSENT_TEXT);
    expect(html).toContain('Выключить');
  });

  it('не ломается при невалидной дате в updatedAt', () => {
    const html = renderToStaticMarkup(
      <ProfileSearchConsentRow
        initialConsent={{
          granted: true,
          policyVersion: 'search-consent-2026-09-27',
          updatedAt: 'invalid-date-string',
        }}
      />,
    );
    expect(html).toContain('обновлено invalid-date-string');
  });
});
