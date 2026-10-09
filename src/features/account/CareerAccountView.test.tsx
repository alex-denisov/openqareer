import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerAccountView } from './CareerAccountView';

describe('CareerAccountView Desktop (B443 Criteria 1-6)', () => {
  it('renders all sections on desktop including tabs', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="prof" />);
    expect(html).toContain('Профиль и вход');
    expect(html).toContain('Подключения');
    expect(html).toContain('Уведомления');
    expect(html).toContain('Согласия и данные');
    expect(html).toContain('Приложение');
    expect(html).toContain('Подписка и платежи');
  });

  it('marks current session device with text «Эта сессия» (Criterion 2)', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="prof" />);
    expect(html).toContain('Входы и устройства');
    expect(html).toContain('Приложение openqareer, этот Mac');
    expect(html).toContain('Эта сессия');
    expect(html).toContain('Выйти на других устройствах');
  });

  it('marks unconfigured features honestly with «Скоро» (Criterion 5)', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="prof" />);
    expect(html).toContain('Двухфакторная защита');
    expect(html).toContain('Ключи доступа (passkeys)');
    expect(html).toContain('Скоро');
  });

  it('renders notifications table with Telegram marked as not connected (Criterion 4)', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="notif" />);
    expect(html).toContain('Уведомления');
    expect(html).toContain('Ответ работодателя');
    expect(html).toContain('Столбец Telegram недоступен, пока бот не подключён');
  });

  it('renders consents with text status and consequences note (Criterion 3)', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="cons" />);
    expect(html).toContain('Согласия');
    expect(html).toContain('Автоотклики');
    expect(html).toContain('Цифровой след');
    expect(html).toContain('Дано 03.10');
    expect(html).toContain('Отзыв останавливает связанную функцию');
    expect(html).toContain('Удалить аккаунт');
  });

  it('renders desktop app settings on desktop (Criterion 6)', () => {
    const html = renderToStaticMarkup(<CareerAccountView initialSection="app" />);
    expect(html).toContain('Приложение');
    expect(html).toContain('Автообновление');
    expect(html).toContain('Значок в строке меню');
    expect(html).toContain('Запуск при входе в систему');
  });
});

describe('CareerAccountView Mobile 390 (B443 Criteria 1 & 6)', () => {
  it('renders mobile layout without «Приложение» section (Criterion 6)', () => {
    const html = renderToStaticMarkup(<CareerAccountView isMobile />);
    expect(html).toContain('data-mv="home"');
    expect(html).toContain('Профиль и вход');
    expect(html).toContain('Подключения');
    expect(html).toContain('Уведомления');
    expect(html).toContain('Согласия и данные');
    expect(html).toContain('Подписка и платежи');
    // On 390, «Приложение» section MUST NOT be present:
    expect(html).not.toContain('data-go="app"');
    expect(html).not.toContain('Приложение openqareer, автообновление');
  });

  it('renders mobile devices view with «Эта сессия» text tag (Criterion 2)', () => {
    const html = renderToStaticMarkup(
      <CareerAccountView isMobile initialMobileView="dev" />,
    );
    expect(html).toContain('data-mv="dev"');
    expect(html).toContain('Входы и устройства');
    expect(html).toContain('Эта сессия');
    expect(html).toContain('Выйти на других устройствах');
  });

  it('renders mobile consents view with dates (Criterion 3)', () => {
    const html = renderToStaticMarkup(
      <CareerAccountView isMobile initialMobileView="cons" />,
    );
    expect(html).toContain('data-mv="cons"');
    expect(html).toContain('Согласия и данные');
    expect(html).toContain('Автоотклики');
    expect(html).toContain('Удалить аккаунт');
  });

  it('renders mobile notifications and detail views (Criterion 4)', () => {
    const html = renderToStaticMarkup(
      <CareerAccountView isMobile initialMobileView="notif" />,
    );
    expect(html).toContain('data-mv="notif"');
    expect(html).toContain('Ответ работодателя');
    expect(html).toContain('Telegram не подключён');
  });
});
