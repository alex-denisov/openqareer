import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage, SignupPage, ResetPasswordPage } from './AuthPages';

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
  });

  it('renders SignupPage with email, name, and password requirements', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<SignupPage onNavigate={handleNavigate} />);

    expect(html).toContain('Создать аккаунт');
    expect(html).toContain('Email');
    expect(html).toContain('Как к вам обращаться');
    expect(html).toContain('Пароль (от 8 символов)');
    expect(html).toContain('Создать аккаунт');
    expect(html).toContain('Войти');
  });

  it('renders ResetPasswordPage with email prompt and submit action', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<ResetPasswordPage onNavigate={handleNavigate} />);

    expect(html).toContain('Восстановление доступа');
    expect(html).toContain('Email аккаунта');
    expect(html).toContain('Отправить ссылку для сброса');
  });
});
