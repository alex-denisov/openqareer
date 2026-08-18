import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('renders H1, value proposition, navigation, and key CTAs', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(<LandingPage onNavigate={handleNavigate} />);

    expect(html).toContain('Карьерная операционная система кандидата');
    expect(html).toContain('Доказательный профиль');
    expect(html).toContain('Честная ATS-диагностика');
    expect(html).toContain('Smart Radar');
    expect(html).toContain('Resume Studio');
    expect(html).toContain('Экосистема');
    expect(html).toContain('Тарифы');
    expect(html).toContain('Часто задаваемые вопросы');
    expect(html).toContain('Войти');
    expect(html).toContain('Начать');
    expect(html).toContain('application/ld+json');
  });

  it('renders "В кабинет" CTA and user badge when candidate session is present', () => {
    const handleNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <LandingPage
        session={{
          username: 'alexey',
          email: 'alexey@example.com',
          displayName: 'Алексей',
          role: 'candidate',
          isTest: false,
          candidateId: 'c-1',
        }}
        onNavigate={handleNavigate}
      />,
    );

    expect(html).toContain('В кабинет');
    expect(html).toContain('Алексей');
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
