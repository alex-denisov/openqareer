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
    expect(html).not.toContain('Мигрировала платёжное ядро');
  });
});
