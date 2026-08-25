import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('states free access without inventing an invite gate', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<LandingPage onNavigate={handleNavigate} />);

    expect(html).toContain('Карьерная операционная система кандидата');
    expect(html).toContain('Бесплатный доступ');
    expect(html).toContain('Загрузите резюме в PDF');
    expect(html).toContain('подключите LinkedIn либо hh.ru в десктопном приложении');
    expect(html).toContain('профиль по фактам');
    expect(html).toContain('карьерную диагностику');
    expect(html).toContain('один следующий шаг');
    expect(html).toContain('Часто задаваемые вопросы');
    expect(html).toContain('Войти');
    expect(html).toContain('Начать');
    expect(html).toContain('application/ld+json');
    for (const unprovenClaim of [
      'Никаких галлюцинаций',
      'полная безопасность аккаунтов',
      'в реальном времени',
      '10+ источников',
      'Telegram-канал',
      'профильные сообщества',
      'форматах PDF и DOCX',
      'Подключить тариф',
      'Пилот по приглашениям',
      'Закрытый H1-пилот',
      'приглашённых участников',
      'Приглашённый пилот',
    ]) {
      expect(html).not.toContain(unprovenClaim);
    }
  });

  it('publishes the same access boundary in structured data and FAQ semantics', () => {
    const html = renderToStaticMarkup(<LandingPage onNavigate={vi.fn()} />);

    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"inLanguage":"ru-RU"');
    expect(html).toContain('"isAccessibleForFree":true');
    expect(html).toContain('"description":"Бесплатный доступ');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('Что я получу после карьерной диагностики?');
    expect(html).toContain('Как добавить профиль LinkedIn или резюме hh.ru?');
    expect(html).not.toContain('"offers"');
  });

  /**
   * «Пилот» is the owner's internal word for the current stage of the product.
   * It leaked into the public page — the hero badge, the section that used to
   * be «Тарифы», the FAQ and the structured data — and told visitors they were
   * joining a programme rather than using a product.
   */
  it('never uses the internal word for the current stage on the public page', () => {
    const html = renderToStaticMarkup(<LandingPage onNavigate={vi.fn()} />);

    expect(html.toLowerCase()).not.toContain('пилот');
  });

  it('presents the access section as tariffs, with no diagnostic-gated badge', () => {
    const html = renderToStaticMarkup(<LandingPage onNavigate={vi.fn()} />);

    expect(html).toContain('id="tariffs"');
    expect(html).toContain('Тарифы');
    expect(html).not.toContain('После диагностики');
  });

  it('renders "В кабинет" CTA and user badge when candidate session is present', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <LandingPage
        session={{
          username: 'alexey',
          email: 'alexey@example.com',
          displayName: 'Мария',
          role: 'candidate',
          isTest: false,
          candidateId: 'c-1',
        }}
        onNavigate={handleNavigate}
      />,
    );

    expect(html).toContain('В кабинет');
    expect(html).toContain('Мария');
    expect(html).not.toContain('Админка');
  });

  it('renders "Админка" and admin panel buttons when admin session is present', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <LandingPage
        session={{
          username: 'admin.test',
          email: 'admin@openqareer.com',
          displayName: 'Администратор',
          role: 'admin',
          isTest: true,
          candidateId: null,
        }}
        onNavigate={handleNavigate}
      />,
    );

    expect(html).toContain('Админка');
    expect(html).toContain('Панель администратора');
    expect(html).toContain('В кабинет');
  });
});
