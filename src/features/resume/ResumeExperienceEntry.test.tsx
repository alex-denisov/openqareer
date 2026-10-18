// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ResumeExperienceEntry } from './ResumeExperienceEntry';
import type { ResumeExperience, ResumeDraft } from './resumeTypes';

const dispose: Array<() => void> = [];

afterEach(() => {
  dispose.splice(0).forEach((cleanup) => cleanup());
});

function assertion<T extends string | boolean>(
  memoryId: string,
  value: T,
  sourceMessageIds: readonly string[],
) {
  return { value, memoryId, sourceMessageIds, reviewFlags: [] as const };
}

describe('ResumeExperienceEntry role description', () => {
  it('renders the linked description as a separate sourced claim', () => {
    const description = assertion('description-memory', 'Role responsibilities in context.', [
      'source-description',
    ]);
    const achievement = assertion('achievement-memory', 'Delivered the migration.', [
      'source-achievement',
    ]);
    const entry: ResumeDraft['experience'][number] = {
      id: 'role-1',
      chronologyMemoryId: 'chronology-1',
      title: 'Engineering Manager',
      employer: 'Example GmbH',
      current: true,
      bulletMemoryIds: [achievement.memoryId],
    };
    const projected: ResumeExperience = {
      id: entry.id,
      title: assertion('chronology-1', entry.title!, ['source-role']),
      employer: assertion('chronology-1', entry.employer!, ['source-role']),
      location: null,
      startDate: null,
      endDate: null,
      current: assertion('chronology-1', true, ['source-role']),
      description,
      bullets: [achievement],
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <ResumeExperienceEntry entry={entry} projected={projected} unknowns={[]} available={[]} />,
      ),
    );

    const descriptionNode = container.querySelector('[data-memory-id="description-memory"]');
    expect(descriptionNode?.textContent).toContain(description.value);
    expect(descriptionNode?.getAttribute('data-source-message-ids')).toBe('source-description');
    const achievementList = container.querySelector('.career-resume-bullets');
    expect(achievementList?.textContent).toContain(achievement.value);
    expect(achievementList?.textContent).not.toContain(description.value);

    act(() => root.unmount());
    container.remove();
  });
});
