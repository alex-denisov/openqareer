import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InterviewPrepModal } from './InterviewPrepModal';
import { SourcePanel } from './MockInterviewSourcePanel';
import { presentQuestionScopeCaption } from './interviewSimulatorPresentation';
import { mockInterviewVacancyFromApplication } from './mockInterviewVacancy';
import type { ApplicationView } from '../applications/applicationsApi';

const vacancy = {
  id: 'app-1',
  applicationId: 'app-1',
  title: 'VP Engineering',
  company: 'Арка Холдинг',
  source: 'hh.ru',
  sourceSavedAt: '2026-10-05T09:00:00',
  interviewAt: '2026-10-10T14:00:00',
};

describe('Мок-интервью по макету 14', () => {
  it('M3: подписи-счёты из плана сервера', () => {
    expect(presentQuestionScopeCaption(['behavioral', 'system_design'])).toBe('2 по требованиям, 3 по STAR');
    expect(presentQuestionScopeCaption(['behavioral'])).toBe('5 по STAR');
    expect(presentQuestionScopeCaption(['system_design'])).toBe('5 по требованиям');
  });

  it('M4: требования, STAR с подтверждением, интервьюеры и источник с датой', () => {
    const html = renderToStaticMarkup(
      <SourcePanel
        vacancy={{ ...vacancy, skills: ['управление 80+ людьми', 'бюджет'] }}
        stories={{ stories: [{ confidence: 'confirmed' }, { confidence: 'unconfirmed' }] } as never}
        onOpenStories={vi.fn()}
      />,
    );
    expect(html).toContain('Управление 80+ людьми, бюджет');
    expect(html).toContain('Ваши STAR-истории: 2');
    expect(html).toContain('Подтверждено 1, не проверено 1');
    expect(html).toContain('Профили не подтверждены: в вопросах не используются');
    expect(html).toContain('Источник: вакансия hh.ru, профиль, 05.10');
  });

  it('M4: без навыков вакансии честно говорит, что вопросы по роли', () => {
    const html = renderToStaticMarkup(<SourcePanel vacancy={vacancy} stories={null} onOpenStories={vi.fn()} />);
    expect(html).toContain('Текст вакансии не сохранён: вопросы по роли «VP Engineering»');
  });

  it('вакансия тренажёра из отклика несёт дату интервью и источник', () => {
    const application = {
      id: 'app-1',
      createdAt: '2026-10-05T09:00:00',
      vacancy: { title: 'VP Engineering', company: 'Арка Холдинг', source: 'hh.ru', url: '' },
      nearestInterview: { id: 'i1', scheduledAt: '2026-10-10T14:00:00', prepStatus: 'none', round: 1 },
    } as unknown as ApplicationView;
    expect(mockInterviewVacancyFromApplication(application)).toEqual(vacancy);
  });

  it('п. 8: «Начать мок-интервью» открывает сразу тренажёр, а не справку', () => {
    const html = renderToStaticMarkup(
      <InterviewPrepModal isOpen onClose={vi.fn()} vacancy={vacancy} startWith="mock" />,
    );
    expect(html).toContain('career-mock-dialog');
    expect(html).toContain('Интервью 10.10, 14:00');
    expect(html).toContain('Прогресс сохраняется');
    expect(html).toContain('5 вопросов, около 15 минут');
    expect(html).not.toContain('career-interview-modal');
  });

  it('«Подготовиться» по-прежнему открывает подготовку', () => {
    const html = renderToStaticMarkup(<InterviewPrepModal isOpen onClose={vi.fn()} vacancy={vacancy} />);
    expect(html).toContain('career-interview-modal');
  });
});
