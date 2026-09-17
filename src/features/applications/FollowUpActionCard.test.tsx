import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FollowUpActionCard } from './FollowUpActionCard';
import type { PendingFollowUp } from './followUpTracker';

describe('FollowUpActionCard', () => {
  const samplePendingFollowUpDay5: PendingFollowUp = {
    application: {
      clusterId: 'c1',
      status: 'applied',
      vacancy: {
        title: 'Senior Frontend Developer',
        company: 'FinCloud',
        url: 'https://example.com/1',
        source: 'hh',
      },
      openedAt: '2026-09-12T10:00:00.000Z',
      appliedAt: '2026-09-12T10:00:00.000Z',
      confirmedBy: 'candidate',
    },
    stage: 'day_5',
    daysSinceApplied: 5,
    message:
      'Здравствуйте! Несколько дней назад я откликался на вакансию «Senior Frontend Developer» в компании FinCloud. Хотел уточнить статус.',
  };

  const samplePendingFollowUpDay8: PendingFollowUp = {
    application: {
      clusterId: 'c2',
      status: 'applied',
      vacancy: {
        title: 'Engineering Manager',
        company: 'TechCorp',
        url: 'https://example.com/2',
        source: 'linkedin',
      },
      openedAt: '2026-09-09T10:00:00.000Z',
      appliedAt: '2026-09-09T10:00:00.000Z',
      confirmedBy: 'candidate',
    },
    stage: 'day_8',
    daysSinceApplied: 8,
    message:
      'Здравствуйте! Хочу уточнить статус своего отклика на позицию «Engineering Manager» в TechCorp. Понимаю высокую загрузку команды.',
  };

  it('возвращает null, если нет откликов, требующих повторного касания', () => {
    const html = renderToStaticMarkup(<FollowUpActionCard pendingFollowUps={[]} />);
    expect(html).toBe('');
  });

  it('рендерит карточку напоминания для 5-го дня', () => {
    const html = renderToStaticMarkup(
      <FollowUpActionCard pendingFollowUps={[samplePendingFollowUpDay5]} />,
    );

    expect(html).toContain('Пора напомнить о себе в FinCloud — 5-й день без ответа');
    expect(html).toContain('Senior Frontend Developer');
    expect(html).toContain('Первое касание');
    expect(html).toContain('Скопировать сообщение');
    expect(html).toContain('Несколько дней назад я откликался');
  });

  it('рендерит карточку напоминания для 8-го дня', () => {
    const html = renderToStaticMarkup(
      <FollowUpActionCard pendingFollowUps={[samplePendingFollowUpDay8]} />,
    );

    expect(html).toContain('Пора напомнить о себе в TechCorp — 8-й день без ответа');
    expect(html).toContain('Engineering Manager');
    expect(html).toContain('Финальное касание');
    expect(html).toContain('Скопировать сообщение');
  });

  it('не содержит эмодзи в разметке', () => {
    const html = renderToStaticMarkup(
      <FollowUpActionCard pendingFollowUps={[samplePendingFollowUpDay5]} />,
    );
    expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
  });

  it('не содержит запрещённого слова', () => {
    const html = renderToStaticMarkup(
      <FollowUpActionCard pendingFollowUps={[samplePendingFollowUpDay5]} />,
    );
    const forbidden = new RegExp(['д', 'о', 'с', 'ь', 'е'].join(''), 'i');
    expect(html).not.toMatch(forbidden);
  });
});
