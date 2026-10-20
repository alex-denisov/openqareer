// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ProfileExperienceSection } from './ProfileExperienceSection';
import { ProfileProvenanceProvider } from './ProfileProvenanceChip';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';

const place = (id: string, employer: string, title: string, start: string, end: string) =>
  ({
    id,
    chronologyMemoryId: `mem-${id}`,
    employer,
    title,
    startDate: start,
    endDate: end,
    current: false,
    bulletMemoryIds: [],
  }) satisfies ResumeExperienceInput;

const draft: ResumeDraft = {
  candidate: { fullName: 'Андрей Лебедев' },
  experience: [
    place('a', 'Финтех Лаб', 'Head of Engineering', '2021-03', '2026-09'),
    place('b', 'Банк Онлайн', 'Engineering Manager', '2017-09', '2021-02'),
    place('c', 'Ритейл Системс', 'Тимлид', '2013-06', '2017-08'),
  ],
  education: [],
  languages: [],
};

describe('ProfileExperienceSection: старые места и происхождение (B541)', () => {
  it('сворачивает третье место в строку и разворачивает по кнопке', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ProfileProvenanceProvider
          importedSources={[]}
          memory={[
            {
              id: 'mem-c',
              kind: 'fact',
              domain: 'role-evidence',
              statement: 'Ритейл Системс, Тимлид',
              confidence: 'candidate-reported',
              sourceMessageIds: ['import'],
              sensitive: false,
              status: 'proposed',
              provenance: { kind: 'import', platform: 'linkedin', at: '2026-09-12T08:00:00.000Z' },
            },
          ]}
        >
          <ProfileExperienceSection draft={draft} onSectionSave={() => undefined} />
        </ProfileProvenanceProvider>,
      ),
    );

    const expand = container.querySelector(
      'button[aria-label="Развернуть место: Ритейл Системс"]',
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    const compact = container.querySelector('.career-profile-screen-place-compact');
    expect(compact?.textContent).toContain('Ритейл Системс');
    expect(compact?.textContent).toContain('Тимлид · 06.2013 — 08.2017');
    expect(compact?.textContent).toContain('из LinkedIn, 12.09');
    expect(container.querySelectorAll('[data-experience-id]')).toHaveLength(2);

    act(() => expand.click());
    expect(container.querySelectorAll('[data-experience-id]')).toHaveLength(3);
    expect(container.querySelector('.career-profile-screen-place-compact')).toBeNull();
    expect(container.textContent).toContain('источник неизвестен');
    act(() => root.unmount());
  });
});
