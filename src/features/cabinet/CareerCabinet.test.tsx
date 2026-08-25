import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CareerCabinet } from './CareerCabinet';
import { CareerRoutePremises } from './CareerTrackBoard';
import type { CareerCabinetView } from './cabinetViews';

const session = {
  username: 'test.candidate',
  email: 'test@example.com',
  displayName: 'Тестовый Кандидат',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'cand-1',
};

const workspace = {
  version: 7 as const,
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z',
  resumeText:
    'Senior Software Engineer with 8+ years experience in TypeScript, React, Node.js and distributed systems architecture.',
  resumeSource: 'text' as const,
  targetDirection: 'Senior Software Engineer',
  regions: ['ru'] as const,
  currentSituation: 'Ищу работу ведущим инженером в технологической компании.',
  constraints: 'Remote / Hybrid',
  urgency: 'active' as const,
  outcomes: [],
};

function renderCabinet(view: CareerCabinetView) {
  return renderToStaticMarkup(
    <CareerCabinet
      view={view}
      session={session}
      workspace={workspace}
      onNavigate={() => undefined}
      onUpdateWorkspace={() => undefined}
      onOpenAccount={() => undefined}
      onOpenExpert={() => undefined}
    />,
  );
}

describe('CareerCabinet route premises', () => {
  it('shows independently reviewable role, geography and work-mode premises', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        regions={['eu', 'ru']}
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Роль и уровень');
    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('География');
    expect(html).toContain('Россия');
    expect(html).toContain('Европа');
    expect(html).toContain('Формат работы');
    expect(html).toContain('Удалённо');
    expect(html).toContain('Изменить роль и условия');
  });
});

describe('CareerCabinet composition', () => {
  it('projects the regions the candidate chose instead of an empty geography (B158, B160)', () => {
    const html = renderCabinet('career');

    expect(html).toContain('География');
    expect(html).toContain('Россия');
    expect(html).not.toContain('Не указана');
  });

  it('says plainly that no region was chosen rather than guessing one', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        regions={[]}
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Регионы не выбраны');
  });

  it('gives «Сегодня» a next action instead of a copy of the profile', () => {
    const html = renderCabinet('today');

    expect(html).toContain('Следующий шаг');
    expect(html).toContain('Состояние карьерного цикла');
    expect(html).not.toContain('Профиль и документы');
    expect(html).not.toContain('Рынок и следующие шаги');
  });

  it('keeps the strategist dialogue out of every section, it lives in «Эксперт»', () => {
    for (const view of ['today', 'profile', 'career', 'opportunities'] as const) {
      expect(renderCabinet(view)).not.toContain('Диалог со стратегом');
    }
  });

  it('gives «Профиль» the evidence surface and nothing from the market panel', () => {
    const html = renderCabinet('profile');

    expect(html).toContain('Профиль и документы');
    expect(html).not.toContain('Рынок и следующие шаги');
  });

  it('gives «Возможности» the market panel', () => {
    expect(renderCabinet('opportunities')).toContain('Рынок и следующие шаги');
  });

  it('does not fabricate candidate or provider outcomes when server data is absent', () => {
    const html = renderCabinet('opportunities');

    expect(html).toContain('Настройте направление');
    expect(html).toContain('Роль или поисковый запрос');
    expect(html).not.toContain('Индекс соответствия');
    expect(html).not.toContain('Авто-поднятие резюме');
    expect(html).not.toContain('откликов отправлено');
    expect(html).not.toContain('Verified Badge');
    expect(html).not.toContain('Tech Enterprise');
    expect(html).not.toContain('Технологическая компания');
  });

  it('never claims data is current, because that claim can never be false', () => {
    for (const view of ['today', 'profile', 'career', 'opportunities'] as const) {
      expect(renderCabinet(view)).not.toContain('Данные актуальны');
    }
  });
});
