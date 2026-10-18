// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileEducationSection } from './ProfileEducationSection';
import { ProfileProjectsSection } from './ProfileTileSections';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import { ProfileCoursesSection } from './ProfileCoursesSection';
import type { ResumeDraft } from './resumeTypes';

const empty: ResumeDraft = {
  candidate: { fullName: 'Тестовый кандидат' },
  experience: [],
  education: [],
  languages: [],
};
type Section = ComponentType<{
  draft: ResumeDraft;
  onSectionSave: (draft: ResumeDraft) => Promise<boolean>;
}>;
const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function render(Section: Section, draft: ResumeDraft = empty) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const save = vi.fn().mockResolvedValue(false);
  act(() => root.render(<Section draft={draft} onSectionSave={save} />));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, save };
}

function button(container: HTMLElement, text: string) {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text || item.getAttribute('aria-label') === text,
  );
  expect(element).toBeDefined();
  return element!;
}

describe('profile collection editing', () => {
  for (const [name, Section, label] of [
    ['education', ProfileEducationSection, 'Добавить образование'],
    ['project', ProfileProjectsSection, 'Добавить проект'],
    ['language', ProfileLanguagesSection, 'Добавить язык'],
    ['course', ProfileCoursesSection, 'Добавить курс'],
  ] as const) {
    it(`does not persist a blank ${name} on Add or Cancel`, () => {
      const { container, save } = render(Section);
      act(() => button(container, label).click());
      expect(container.querySelector('input')).not.toBeNull();
      expect(save).not.toHaveBeenCalled();
      act(() => button(container, 'Отменить').click());
      expect(save).not.toHaveBeenCalled();
    });
  }

  it('retains education input and edit mode when the server rejects saving', async () => {
    const draft = {
      ...empty,
      education: [
        {
          id: 'education-1',
          evidenceMemoryId: 'manual-source',
          institution: 'Тестовый университет',
        },
      ],
    };
    const { container, save } = render(ProfileEducationSection, draft);
    act(() => button(container, 'Изменить образование').click());
    await act(async () => button(container, 'Сохранить').click());
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector('input')?.value).toBe('Тестовый университет');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
