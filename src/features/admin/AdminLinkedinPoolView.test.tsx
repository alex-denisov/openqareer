import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminLinkedinPoolView,
  isSafeAdminLinkedinSessionPage,
} from './AdminLinkedinPoolView';

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

  it('requires a classified signed-in LinkedIn page before confirming a pool session', () => {
    expect(
      isSafeAdminLinkedinSessionPage({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
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
        login: true,
        otp: false,
        captcha: false,
      }),
    ).toBe(false);
  });
});
