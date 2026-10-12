// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileReviewAndVersions } from './ProfileReviewAndVersions';
import type { ResumeDraft } from './resumeTypes';

const MOCK_DRAFT: ResumeDraft = {
  candidate: {
    fullName: 'Алексей Денисов',
    headline: 'Engineering Director / VP',
    contact: { location: 'Москва' },
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
    act(() => root.render(<ProfileAboutSection draft={MOCK_DRAFT} onSectionSave={onSave} />));

    const editBtn = container.querySelector('[data-testid="about-edit-text-btn"]') as HTMLButtonElement;
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
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProfileAboutSection draft={MOCK_DRAFT} onSectionSave={onSave} />));

    const suggestBtn = container.querySelector(
      '[data-testid="about-consultant-suggest-btn"]',
    ) as HTMLButtonElement;
    expect(suggestBtn).not.toBeNull();
    expect(suggestBtn.textContent).toContain('Предложить вариант с консультантом');

    act(() => suggestBtn.click());
    expect(container.textContent).toMatch(/Принять/i);

    act(() => root.unmount());
    container.remove();
  });

  it('ProfileReviewAndVersions renders "Исправить вместе с консультантом" and "Заполнить анкету"', () => {
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
    expect(fixBtn.textContent).toContain('Исправить вместе с консультантом');
    act(() => fixBtn.click());
    expect(onOpenExpert).toHaveBeenCalled();

    const questBtn = container.querySelector(
      '[data-testid="review-fill-questionnaire-btn"]',
    ) as HTMLButtonElement;
    expect(questBtn).not.toBeNull();
    expect(questBtn.textContent).toContain('Заполнить анкету');
    act(() => questBtn.click());
    expect(onFillQuestionnaire).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('ResumeVersionsCard renders "Создать версию под вакансию" and creates targeted version', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProfileReviewAndVersions draft={MOCK_DRAFT} memory={[]} />));

    const createBtn = container.querySelector(
      '[data-testid="create-targeted-version-btn"]',
    ) as HTMLButtonElement;
    expect(createBtn).not.toBeNull();
    expect(createBtn.textContent).toContain('Создать версию под вакансию');
    act(() => createBtn.click());

    const input = container.querySelector(
      '[data-testid="targeted-version-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      input.value = 'Вектор Банк';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const submitBtn = container.querySelector(
      '[data-testid="submit-targeted-version-btn"]',
    ) as HTMLButtonElement;
    act(() => submitBtn.click());

    expect(container.textContent).toContain('Под вакансию «Вектор Банк»');
    expect(container.textContent).toContain('Черновик ждёт вашего одобрения');

    act(() => root.unmount());
    container.remove();
  });
});
