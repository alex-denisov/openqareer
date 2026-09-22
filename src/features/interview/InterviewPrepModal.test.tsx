import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InterviewPrepModal } from './InterviewPrepModal';
import type { CandidateMemory } from '../coach/coachApi';

describe('InterviewPrepModal', () => {
  const sampleVacancy = {
    id: 'vac-201',
    title: 'Lead Frontend Engineer',
    company: 'FinTech Group',
    descriptionSummary: 'Разработка финтех-платформы, оптимизация производительности, React, TypeScript.',
    skills: ['React', 'TypeScript', 'Performance'],
    location: 'Москва',
    isRemote: true,
  };

  const sampleFacts: CandidateMemory[] = [
    {
      id: 'fact-1',
      kind: 'fact',
      domain: 'outcome',
      statement: 'Ускорил загрузку страниц на 45% за счёт внедрения SSR и оптимизации бандла.',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['m1'],
      sensitive: false,
      status: 'confirmed',
    },
    {
      id: 'fact-2',
      kind: 'fact',
      domain: 'skill',
      statement: 'Эксперт по архитектуре масштабируемых веб-приложений и дизайн-системам.',
      confidence: 'candidate-confirmed',
      sourceMessageIds: ['m2'],
      sensitive: false,
      status: 'confirmed',
    },
  ];

  it('возвращает null, если isOpen равен false', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={false}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
      />,
    );
    expect(html).toBe('');
  });

  it('рендерит диалоговое окно с заголовком и табами', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="career-interview-title"');
    expect(html).toContain('Lead Frontend Engineer');
    expect(html).toContain('FinTech Group');
    expect(html).toContain('Компания и что им важно');
    expect(html).toContain('Вопросы к вам (STAR)');
    expect(html).toContain('Ваши вопросы им');
  });

  it('рендерит справку о компании и фокус интервьюера во вкладке overview', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
        initialTab="overview"
      />,
    );

    expect(html).toContain('FinTech Group');
    expect(html).toContain('React');
    expect(html).toContain('TypeScript');
    expect(html).toContain('На что сделать упор');
    expect(html).toContain('О чём спросят вероятнее всего');
    expect(html).toContain('Новости компании и профиль интервьюера не подключены');
  });

  it('рендерит вопросы и ответы по формуле STAR во вкладке star', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
        initialTab="star"
      />,
    );

    expect(html).toContain('Ситуация:');
    expect(html).toContain('Задача:');
    expect(html).toContain('Действие:');
    expect(html).toContain('Результат:');
    expect(html).toContain('Скопировать');
    expect(html).toContain('45%');
  });

  it('помечает STAR-вопросы без фактов как требующие собственного примера', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={[]}
        initialTab="star"
      />,
    );

    expect(html).toContain('Нужен ваш пример: подтверждённых фактов для этого ответа нет');
  });

  it('рендерит 5 встречных вопросов работодателю во вкладке questions', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
        initialTab="questions"
      />,
    );

    expect(html).toContain('Ваши вопросы им');
    expect(html).toContain('первые 3-6 месяцев');
    expect(html).toContain('Скопировать');
  });

  it('не содержит эмодзи ни в одном элементе разметки', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
      />,
    );
    expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
  });

  it('не содержит запрещённого слова', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        facts={sampleFacts}
      />,
    );
    const forbidden = new RegExp(['д', 'о', 'с', 'ь', 'е'].join(''), 'i');
    expect(html).not.toMatch(forbidden);
  });
});
