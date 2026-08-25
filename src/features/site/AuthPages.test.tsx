import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LoginPage,
  SignupPage,
  ResetPasswordPage,
  ResetForm,
  requestPublicPasswordReset,
} from './AuthPages';

describe('AuthPages', () => {
  it('renders LoginPage with email/password fields and navigation links', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<LoginPage onNavigate={handleNavigate} />);

    expect(html).toContain('Вход в кабинет');
    expect(html).toContain('Email или логин');
    expect(html).toContain('Пароль');
    expect(html).toContain('Войти в кабинет');
    expect(html).toContain('Зарегистрироваться');
    expect(html).toContain('Забыли пароль?');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autoComplete="username email"');
    expect(html).toContain('autoComplete="current-password"');
  });

  it('renders SignupPage with email, name and password fields', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<SignupPage onNavigate={handleNavigate} />);

    expect(html).toContain('Создать аккаунт');
    expect(html).toContain('Email');
    expect(html).toContain('Как к вам обращаться');
    expect(html).toContain('Пароль (от 8 символов)');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('Войти');
  });

  /**
   * The owner's own first name stood in the signup form as the example of a
   * name to type. A placeholder is example data, and example data must not be
   * a real person — the same rule that closed INC-023 for test fixtures.
   */
  it('never uses a real person as the example name', () => {
    const html = renderToStaticMarkup(<SignupPage onNavigate={vi.fn()} />);

    for (const name of ['Алексей', 'Денисов', 'Alexey', 'Denisov']) {
      expect(html, name).not.toContain(name);
    }
  });

  /**
   * A generator invents a password the candidate has not seen and cannot
   * remember, on a form that offers no way to read what is in the field. The
   * owner asked for the opposite: no generator, and the typed password
   * readable.
   */
  it('offers no password generator', () => {
    const html = renderToStaticMarkup(<SignupPage onNavigate={vi.fn()} />);

    expect(html).not.toContain('Сгенерировать');
    expect(html).not.toContain('сгенерирован');
  });

  it('lets the candidate read the password they typed', () => {
    for (const page of [
      renderToStaticMarkup(<SignupPage onNavigate={vi.fn()} />),
      renderToStaticMarkup(<LoginPage onNavigate={vi.fn()} />),
    ]) {
      expect(page).toContain('Показать пароль');
      expect(page).toContain('aria-pressed="false"');
      expect(page).toContain('type="password"');
    }
  });

  it('styles the auth form with classes, not attributes production CSP drops', () => {
    for (const page of [
      renderToStaticMarkup(<SignupPage onNavigate={vi.fn()} />),
      renderToStaticMarkup(<LoginPage onNavigate={vi.fn()} />),
    ]) {
      expect(page).not.toContain('style="');
    }
  });

  it('renders ResetPasswordPage with email prompt and submit action', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<ResetPasswordPage onNavigate={handleNavigate} />);

    expect(html).toContain('Восстановление доступа');
    expect(html).toContain('Email аккаунта');
    expect(html).toContain('name="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('Отправить ссылку для сброса');
  });

  it('programmatically associates a reset failure with the email field', () => {
    const html = renderToStaticMarkup(
      <ResetForm
        onResult={() => undefined}
        onEdit={() => undefined}
        errorMessage="Не удалось запросить восстановление доступа."
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="reset-email-error"');
    expect(html).toContain('id="reset-email-error"');
    expect(html).toContain('role="alert"');
  });

  it('reports an accepted reset request without revealing whether the account exists', async () => {
    const requestReset = vi.fn().mockResolvedValue(true);

    const result = await requestPublicPasswordReset(' candidate@example.com ', requestReset);

    expect(requestReset).toHaveBeenCalledWith('candidate@example.com');
    expect(result).toEqual({
      status: 'delivery-configured',
      message:
        'Если аккаунт существует, письмо со ссылкой отправлено на указанный email.',
    });
  });

  it('states plainly when password-reset email delivery is not configured', async () => {
    const requestReset = vi.fn().mockResolvedValue(false);

    const result = await requestPublicPasswordReset('candidate@example.com', requestReset);

    expect(result).toEqual({
      status: 'delivery-unconfigured',
      message:
        'Отправка писем пока не подключена. Доступ не изменён; восстановление станет доступно после настройки почтового домена.',
    });
  });

  it('returns an actionable error instead of treating a failed request as sent', async () => {
    const requestReset = vi.fn().mockRejectedValue(new Error('socket closed'));

    const result = await requestPublicPasswordReset('candidate@example.com', requestReset);

    expect(result).toEqual({
      status: 'error',
      message: 'Не удалось запросить восстановление доступа. Попробуйте ещё раз.',
    });
  });
});
