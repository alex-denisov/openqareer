import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminLinkedinPoolView,
  isAdminProfileCaptureFailure,
  isSafeAdminLinkedinSessionPage,
} from './AdminLinkedinPoolView';

describe('AdminLinkedinPoolView', () => {
  it('names the admin-only identifier boundary and desktop login flow', () => {
    const html = renderToStaticMarkup(<AdminLinkedinPoolView />);

    expect(html).toContain('Аккаунты LinkedIn');
    expect(html).toContain('Идентификатор сессии');
    expect(html).toContain('только администратору');
    expect(html).toContain('OpenQareer Desktop');
    expect(html).not.toContain('Provider account marker');
    expect(html).not.toContain('Метка администратора');
    expect(html).not.toContain('mask');
  });

  it('accepts an authenticated LinkedIn page when profile capture itself is unavailable', () => {
    expect(isAdminProfileCaptureFailure(new Error('linkedin_authenticated_capture_failed'))).toBe(
      true,
    );
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/in/me/',
        signedInApplicant: false,
        login: false,
        otp: false,
        captcha: false,
      }),
    ).toBe(true);
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/login',
        signedInApplicant: false,
        login: true,
        otp: false,
        captcha: false,
      }),
    ).toBe(false);
  });
});
