import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminLinkedinPoolView,
  isSafeAdminLinkedinSessionPage,
} from './AdminLinkedinPoolView';
import { adminLinkedinFailureCopy } from './linkedinPoolStatusCopy';

describe('AdminLinkedinPoolView', () => {
  it('names the admin-only identifier boundary and desktop login flow', () => {
    const html = renderToStaticMarkup(<AdminLinkedinPoolView />);

    expect(html).toContain('Аккаунты LinkedIn');
    expect(html).toContain('Идентификатор сессии');
    expect(html).toContain('Поиск аккаунта');
    expect(html).toContain('Добавить аккаунт');
    expect(html).not.toContain('Полный идентификатор виден только администратору');
    expect(html).toContain('OpenQareer Desktop');
    expect(html).not.toContain('Provider account marker');
    expect(html).not.toContain('Метка администратора');
    expect(html).not.toContain('mask');
  });

  it('renders TimezoneSelect in add form without IANA label and default Moscow (B332)', () => {
    const html = renderToStaticMarkup(<AdminLinkedinPoolView />);
    expect(html).not.toContain('Часовой пояс (IANA)');
    expect(html).toContain('Часовой пояс');
    expect(html).toContain('name="timezone"');
    expect(html).toContain('value="Europe/Moscow"');
    expect(html).toContain('Москва (UTC+3)');
  });

  it('requires a classified signed-in LinkedIn page before confirming a pool session', () => {
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
        accountMarker: 'synthetic-profile-marker',
        login: false,
        otp: false,
        captcha: false,
      }),
    ).toBe(true);
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: false,
        accountMarker: 'synthetic-profile-marker',
        login: false,
        otp: false,
        captcha: false,
      }),
    ).toBe(false);
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/login',
        signedInApplicant: false,
        accountMarker: 'synthetic-profile-marker',
        login: true,
        otp: false,
        captcha: false,
      }),
    ).toBe(false);
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
    ).toBe(false);
  });

  it('shows a plain manual-review reason for safety stops without exposing provider payloads', () => {
    expect(adminLinkedinFailureCopy('platform_restricted')).toMatch(/остановлен/u);
    expect(adminLinkedinFailureCopy('unexpected_page')).toMatch(/неожидан/u);
    expect(adminLinkedinFailureCopy('challenge_required')).toMatch(/вручную/u);
  });
});
