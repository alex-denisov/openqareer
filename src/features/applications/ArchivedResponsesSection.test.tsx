// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { ArchivedResponsesSection } from './ArchivedResponsesSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function archivedApplication(
  id: string,
  archiveReason: NonNullable<ApplicationView['archiveReason']>,
): ApplicationView {
  return {
    id,
    candidateId: 'candidate-1',
    clusterId: `cluster-${id}`,
    stage: 'archived',
    closedReason: null,
    archiveReason,
    archivePreviousStage: 'applied',
    processProfile: 'standard',
    vacancy: { title: `Role ${id}`, company: 'Acme', url: '', source: 'test' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-01T00:00:00.000Z',
    version: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    followUp: null,
    whoseTurn: null,
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
    archiveStaleDays: 45,
  };
}

describe('ArchivedResponsesSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the archive and shows reasons, including the configured stale period', () => {
    const applications = [
      archivedApplication('candidate', 'candidate'),
      archivedApplication('stale', 'stale'),
      archivedApplication('legacy', 'unknown'),
    ];
    act(() => {
      root.render(<ArchivedResponsesSection applications={applications} onRestore={vi.fn()} />);
    });

    const toggle = container.querySelector('.career-responses-archive-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Архив');
    expect(toggle.textContent).toContain('3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle.click());

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Вы перенесли в архив');
    expect(container.textContent).toContain('Нет движения 45 дней');
    expect(container.textContent).toContain('Причина не записана');
  });

  it('keeps the actual restore action available for each archived card', async () => {
    const application = archivedApplication('candidate', 'candidate');
    const onRestore = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(
        <ArchivedResponsesSection applications={[application]} initiallyOpen onRestore={onRestore} />,
      );
    });
    const restore = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Вернуть в работу'),
    );

    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });

    expect(onRestore).toHaveBeenCalledWith(application);
  });

  it('shows an error when restoration fails instead of implying success', async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error('write failed'));
    act(() => {
      root.render(
        <ArchivedResponsesSection
          applications={[archivedApplication('candidate', 'candidate')]}
          initiallyOpen
          onRestore={onRestore}
        />,
      );
    });
    const restore = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Вернуть в работу'),
    );

    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось вернуть отклик в работу',
    );
  });

  it('renders archive pages in groups of twenty', () => {
    const applications = Array.from({ length: 21 }, (_, index) =>
      archivedApplication(`card-${index}`, 'candidate'),
    );
    act(() => {
      root.render(
        <ArchivedResponsesSection applications={applications} initiallyOpen onRestore={vi.fn()} />,
      );
    });
    expect(container.querySelectorAll('.career-responses-archive-card')).toHaveLength(20);

    const more = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Показать ещё'),
    );
    act(() => more?.click());

    expect(container.querySelectorAll('.career-responses-archive-card')).toHaveLength(21);
  });
});
