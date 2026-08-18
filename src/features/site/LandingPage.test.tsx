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
    expect(html).toContain('Умная витрина вакансий');
    expect(html).toContain('Resume Studio');
    expect(html).toContain('Тарифы');
    expect(html).toContain('Часто задаваемые вопросы');
    expect(html).toContain('Войти');
    expect(html).toContain('Начать');
    expect(html).toContain('application/ld+json');
  });

  it('renders "В кабинет" CTA when session is present', () => {
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
  });
});
