import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('states free access without inventing an invite gate', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<LandingPage onNavigate={handleNavigate} />);

    // Hero — вариант B отчёта маркетолога (B236, решение владельца 2026-09-21).
    expect(html).toContain('Ваш поиск работы под контролем');
    expect(html).toContain('Основной путь бесплатен и без срока');
    expect(html).toContain('ничего не отправляет без вашего');
    expect(html).toContain('Один профиль по фактам');
    expect(html).toContain('один следующий шаг');
    expect(html).toContain('Вопросы перед регистрацией');
    expect(html).toContain('Войти');
    expect(html).toContain('Создать аккаунт');
    expect(html).toContain('Собрать профиль из резюме');
    expect(html).toContain('application/ld+json');
    // Площадок много: ни одна строка не подаёт hh.ru или LinkedIn как единственный путь.
    expect(html).not.toContain('десктопн');
    expect(html).not.toContain('в десктопном приложении');
    expect(html).toContain('LinkedIn, hh.ru и другие');
    // Внутренние слова продукта не показываются кандидату.
    expect(html).not.toContain('диагностик');
    expect(html).not.toContain('операционная система');
    expect(html).not.toContain('выборк');
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
    expect(html).toContain('Что я увижу после загрузки резюме?');
    expect(html).toContain('Как добавить профили с площадок, где я ищу работу?');
    expect(html).toContain('Отправляет ли OpenQareer отклики за меня?');
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

  it('renders "Открыть кабинет" CTA and user badge when candidate session is present', () => {
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

    expect(html).toContain('Открыть кабинет');
    expect(html).toContain('Мария');
    expect(html).not.toContain('Администрирование');
  });

  it('renders "Администрирование" and admin panel buttons when admin session is present', () => {
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

    expect(html).toContain('Администрирование');
    expect(html).toContain('Панель администратора');
    expect(html).toContain('Открыть кабинет');
  });

  it('renders landing actions as semantic anchor links without button site-btn or link-btn elements', () => {
    const guestHtml = renderToStaticMarkup(<LandingPage onNavigate={vi.fn()} />);
    const adminHtml = renderToStaticMarkup(
      <LandingPage
        session={{
          username: 'admin.test',
          email: 'admin@openqareer.com',
          displayName: 'Администратор',
          role: 'admin',
          isTest: true,
          candidateId: null,
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(guestHtml).toContain('href="/signup"');
    expect(guestHtml).toContain('href="/login"');
    expect(adminHtml).toContain('href="/app"');
    expect(adminHtml).toContain('href="/admin"');

    for (const html of [guestHtml, adminHtml]) {
      expect(html).not.toMatch(/<button[^>]*class="[^"]*(site-btn|link-btn)[^"]*"/u);
    }
  });
});
