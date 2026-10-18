// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileResumeReview, ProfileReviewAndVersions } from './ProfileReviewAndVersions';
import { ProfileResumeVersions } from './ProfileReviewAndVersions';
import type { ResumeDraft } from './resumeTypes';

import { renderToStaticMarkup } from 'react-dom/server';
const MOCK_DRAFT: ResumeDraft = {
  candidate: {
    fullName: 'Алексей Денисов',
    headline: 'Engineering Director / VP',
    contact: { location: 'Москва', email: 'candidate@example.test' },
    about: 'Руковожу инженерией финтех-платформ. Ищу роль CTO в продуктовой компании.',
  },
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-exp-1',
      title: 'Engineering Director',
      employer: 'Финтех Лаб',
      startDate: '2021-01',
      endDate: '2024-05',
      current: false,
      bulletMemoryIds: [],
    },
  ],
  education: [],
  skills: [],
  languages: [],
};

describe('B476: Profile gaps mechanics (About & Review & Versions)', () => {
  it('ProfileAboutSection displays "Изменить текст" and enables edit mode', () => {
    const onSave = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(<ProfileAboutSection draft={MOCK_DRAFT} onSectionSave={onSave} detailView />),
    );

    const editBtn = container.querySelector(
      '[data-testid="about-edit-text-btn"]',
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    expect(editBtn.textContent).toContain('Изменить текст');

    act(() => editBtn.click());
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('ProfileAboutSection displays "Предложить вариант с консультантом" and activates suggestion', () => {
    const onSave = vi.fn();
    const onSuggestWithConsultant = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ProfileAboutSection
          detailView
          draft={MOCK_DRAFT}
          onSectionSave={onSave}
          onSuggestWithConsultant={onSuggestWithConsultant}
        />,
      ),
    );

    const suggestBtn = container.querySelector(
      '[data-testid="about-consultant-suggest-btn"]',
    ) as HTMLButtonElement;
    expect(suggestBtn).not.toBeNull();
    expect(suggestBtn.textContent).toContain('Предложить вариант с консультантом');

    act(() => suggestBtn.click());
    expect(onSuggestWithConsultant).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.career-consultant-suggestion')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('ProfileReviewAndVersions renders "Собрать факты с консультантом" and "Заполнить анкету"', () => {
    const onOpenExpert = vi.fn();
    const onFillQuestionnaire = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ProfileReviewAndVersions
          draft={MOCK_DRAFT}
          memory={[]}
          onOpenExpert={onOpenExpert}
          onFillQuestionnaire={onFillQuestionnaire}
        />,
      ),
    );

    const fixBtn = container.querySelector(
      '[data-testid="review-fix-with-consultant-btn"]',
    ) as HTMLButtonElement;
    expect(fixBtn).not.toBeNull();
    expect(fixBtn.textContent).toContain('Собрать факты с консультантом');
    act(() => fixBtn.click());
    expect(onOpenExpert).toHaveBeenCalled();

    const questBtn = container.querySelector(
      '[data-testid="review-fill-questionnaire-btn"]',
    ) as HTMLButtonElement;
    expect(questBtn).not.toBeNull();
    expect(questBtn.textContent).toContain('Заполнить анкету');
    act(() => questBtn.click());
    expect(onFillQuestionnaire).toHaveBeenCalledWith('Образование');

    act(() => root.unmount());
    container.remove();
  });

  it('exports the review card as a standalone Profile detail', () => {
    const html = renderToStaticMarkup(
      <ProfileResumeReview draft={MOCK_DRAFT} memory={[]} onOpenExpert={() => undefined} />,
    );

    expect(html).toContain('Проверка резюме');
    expect(html).toContain('Собрать факты с консультантом');
  });

  it('ResumeVersionsCard shows the persistent version entry point without local fake rows', () => {
    const html = renderToStaticMarkup(<ProfileResumeVersions draft={MOCK_DRAFT} memory={[]} />);

    expect(html).toContain('aria-controls="docs-more"');
    expect(html).toContain('Сохранённых снимков резюме под вакансию пока нет');
    expect(html).not.toContain('вер-');
    expect(html).not.toContain('Черновик ждёт вашего одобрения');
  });
});
