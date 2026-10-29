// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileDesktopSkills } from './ProfileDesktopSkills';
import type { ProfileMobileDataProps } from './profileMobileTypes';
import type { ResumeDraft } from './resumeTypes';

vi.mock('../skills/roleSkillAssessmentApi', () => ({
  getCurrentRoleSkillAssessment: () => new Promise(() => {}),
}));

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function render(skills: NonNullable<ResumeDraft['skills']>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const draft = {
    candidate: { fullName: 'Тестовый кандидат' },
    experience: [],
    education: [],
    languages: [],
    skills,
  } as ResumeDraft;
  const props = {
    candidateId: 'candidate-1',
    draft,
    saving: false,
    onSectionSave: vi.fn(),
    onOpenSkillQuizBank: vi.fn(),
  } as unknown as ProfileMobileDataProps;
  act(() => root.render(<ProfileDesktopSkills {...props} />));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('profile skills show where a skill gets confirmed', () => {
  // Prod 27.10: the confirmed skill stood 35th behind «Показано 6 из 35» and the
  // candidate concluded no skill had been confirmed.
  it('lists confirmed skills before the rest, so the verdict is visible without expanding', () => {
    const plain = Array.from({ length: 8 }, (_, index) => ({
      id: `s-${index}`,
      name: `Навык ${index}`,
    }));
    const container = render([
      ...plain,
      { id: 'docker', name: 'Docker', status: 'подтверждён', source: 'Банк квизов LinkedIn' },
    ]);
    const rows = [...container.querySelectorAll('.profile-desktop-skill-row b')].map(
      (row) => row.textContent,
    );
    expect(rows[0]).toBe('Docker');
    expect(container.textContent).toContain('Подтверждено 1 из 9');
  });

  it('says in one line how a skill is confirmed', () => {
    const container = render([{ id: 's-1', name: 'Docker' }]);
    expect(container.textContent).toContain(
      'Навык можно подтвердить двумя путями: коротким тестом или разбором опыта в беседе с консультантом.',
    );
  });
});
