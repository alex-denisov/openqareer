// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileAtsAssessment } from './ProfileAtsAssessment';

const api = vi.hoisted(() => ({
  getResumeAtsAssessment: vi.fn(),
  getResumeVersions: vi.fn(),
}));
vi.mock('./resumeVersionsApi', () => api);
vi.mock('../coach/coachApi', () => ({ getRoleHypotheses: vi.fn(async () => []) }));

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});

function render(onDemand: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ProfileAtsAssessment onDemand={onDemand} />));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('ATS block on demand (D2/D4)', () => {
  it('does not call the assessment endpoint on mount', async () => {
    api.getResumeVersions.mockResolvedValue({ items: [], currentMasterRevision: 1 });
    const container = render(true);
    await act(async () => undefined);
    expect(api.getResumeAtsAssessment).not.toHaveBeenCalled();
    expect(api.getResumeVersions).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Рассчитать оценку');
  });

  it('hides the «— из 100» scale when the assessment failed, keeping error and retry', async () => {
    api.getResumeVersions.mockRejectedValue(new Error('x'));
    const container = render(true);
    const run = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Рассчитать оценку'),
    );
    await act(async () => run?.click());
    await act(async () => undefined);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('из 100');
    expect(container.textContent).toContain('Повторить');
  });
});
