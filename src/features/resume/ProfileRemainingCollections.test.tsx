// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileAchievementsSection } from './ProfileAchievementsSection';
import { ProfileRecommendationsSection } from './ProfileRecommendationsSection';
import { ProfileCertificatesSection } from './ProfileTileSections';
import type { ResumeDraft } from './resumeTypes';

const empty: ResumeDraft = {
  candidate: { fullName: 'Тестовый кандидат' },
  experience: [],
  education: [],
  languages: [],
};
type Section = ComponentType<{
  draft: ResumeDraft;
  onSectionSave: (draft: ResumeDraft) => boolean | void | Promise<boolean | void>;
}>;
const disposers: Array<() => void> = [];

afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  expect(element).toBeDefined();
  return element as HTMLButtonElement;
}

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

describe('remaining profile collections', () => {
  it.each([
    ['recommendation', ProfileRecommendationsSection, 'Добавить рекомендацию'],
    ['achievement', ProfileAchievementsSection, 'Добавить достижение'],
    ['certificate', ProfileCertificatesSection, 'Добавить сертификат'],
  ] as const)('keeps a blank %s local until it is saved', (_name, Section, addLabel) => {
    const { container, save } = render(Section);
    act(() => button(container, addLabel).click());
    expect(container.querySelector('input, textarea')).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    act(() => button(container, 'Отменить').click());
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    [
      'recommendation',
      ProfileRecommendationsSection,
      {
        ...empty,
        recommendations: [{ id: 'rec-1', text: 'Рекомендация кандидата' }],
      },
      'Изменить рекомендацию',
      'Рекомендация кандидата',
      'textarea',
    ],
    [
      'achievement',
      ProfileAchievementsSection,
      {
        ...empty,
        achievements: [{ id: 'achievement-1', kind: 'honor' as const, title: 'Награда' }],
      },
      'Изменить достижение',
      'Награда',
      'input',
    ],
    [
      'certificate',
      ProfileCertificatesSection,
      {
        ...empty,
        certifications: [{ id: 'certificate-1', name: 'Сертификат' }],
      },
      'Изменить сертификат',
      'Сертификат',
      'input',
    ],
  ] as const)(
    'retains %s inputs when the server rejects the update',
    async (_name, Section, draft, editLabel, initialValue, inputSelector) => {
      const { container, save } = render(Section, draft);
      act(() => button(container, editLabel).click());
      await act(async () => button(container, 'Сохранить').click());

      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(inputSelector);
      expect(save).toHaveBeenCalledOnce();
      expect(input?.value).toBe(initialValue);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    },
  );
});
