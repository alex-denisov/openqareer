import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CareerCabinet, CareerRoutePremises } from './CareerCabinet';

describe('CareerCabinet route premises', () => {
  it('shows independently reviewable role, geography and work-mode premises', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        location="Берлин"
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Роль и уровень');
    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('География');
    expect(html).toContain('Берлин');
    expect(html).toContain('Формат работы');
    expect(html).toContain('Удалённо');
    expect(html).toContain('Изменить роль и условия');
  });

  it('renders TodayView with CareerIntelligencePanel without errors', () => {
    const html = renderToStaticMarkup(
      <CareerCabinet
        view="today"
        session={{
          username: 'test.candidate',
          email: 'test@example.com',
          displayName: 'Тестовый Кандидат',
          role: 'candidate',
          isTest: false,
          candidateId: 'cand-1',
        }}
        workspace={{
          version: 6,
          createdAt: '2026-08-18T12:00:00.000Z',
          updatedAt: '2026-08-18T12:00:00.000Z',
          resumeText:
            'Senior Software Engineer with 8+ years experience in TypeScript, React, Node.js and distributed systems architecture.',
          resumeSource: 'text',
          targetDirection: 'Senior Software Engineer',
          market: 'ru',
          currentSituation: 'Ищу работу ведущим инженером в технологической компании.',
          constraints: 'Remote / Hybrid',
          urgency: 'active',
          outcomes: [],
        }}
        onNavigate={() => undefined}
        onUpdateWorkspace={() => undefined}
        onOpenAccount={() => undefined}
      />,
    );

    expect(html).toContain('Рынок и следующие шаги');
    expect(html).toContain('Авто-поднятие резюме');
    expect(html).toContain('Job-Fit');
  });
});
