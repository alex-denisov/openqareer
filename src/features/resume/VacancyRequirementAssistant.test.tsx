import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { VacancyRequirementAssistant } from './VacancyRequirementAssistant';

describe('VacancyRequirementAssistant (C66)', () => {
  it('offers manual input when the existing profile has no confirmed experience evidence', () => {
    const html = renderToStaticMarkup(
      <VacancyRequirementAssistant
        draft={EMPTY_RESUME_DRAFT}
        memory={[]}
        request={{
          requestId: 'c66-request-1',
          requirement: 'Опыт работы с Kubernetes',
          vacancyId: 'vacancy-1',
          vacancyTitle: 'Platform Engineer',
          vacancyCompany: 'Acme Systems',
        }}
        onHandled={vi.fn()}
        onSuggestionPrepared={vi.fn()}
        onManualFactAdded={vi.fn()}
      />,
    );

    expect(html).toContain('В профиле нет подтверждённого опыта для этого требования.');
    expect(html).toContain('Что именно вы делали?');
    expect(html).toContain('Добавить факт в профиль');
    expect(html).toContain('Требование вакансии: <strong>Опыт работы с Kubernetes</strong>');
    expect(html).not.toContain('Мигрировала платёжное ядро');
  });

  it('renders level human name instead of skill requirement label for levels (D28)', () => {
    const renderForReq = (requirement: string) =>
      renderToStaticMarkup(
        <VacancyRequirementAssistant
          draft={EMPTY_RESUME_DRAFT}
          memory={[]}
          request={{
            requestId: 'd28-test',
            requirement,
            vacancyId: 'v-1',
            vacancyTitle: 'Engineering Manager',
            vacancyCompany: 'Acme Corp',
          }}
          onHandled={vi.fn()}
          onSuggestionPrepared={vi.fn()}
          onManualFactAdded={vi.fn()}
        />,
      );

    const vpHtml = renderForReq('vp');
    expect(vpHtml).toContain('Уровень вакансии: <strong>VP</strong>');
    expect(vpHtml).not.toContain('Требование вакансии:');

    const icHtml = renderForReq('ic');
    expect(icHtml).toContain('Уровень вакансии: <strong>Специалист</strong>');

    const leadHtml = renderForReq('lead');
    expect(leadHtml).toContain('Уровень вакансии: <strong>Лид</strong>');

    const headHtml = renderForReq('head');
    expect(headHtml).toContain('Уровень вакансии: <strong>Руководитель</strong>');

    const cLevelHtml = renderForReq('c-level');
    expect(cLevelHtml).toContain('Уровень вакансии: <strong>C-level</strong>');
  });
});
