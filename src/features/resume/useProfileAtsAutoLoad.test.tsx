// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileAtsAssessment } from './ProfileAtsAssessment';
import { clearProfileAtsAssessmentCache, useProfileAtsAssessment } from './useProfileAtsAssessment';

const api = vi.hoisted(() => ({
  getProfileAtsAssessment: vi.fn(),
  getResumeAtsAssessment: vi.fn(),
  getResumeVersions: vi.fn(),
}));
vi.mock('./resumeVersionsApi', () => api);
vi.mock('../coach/coachApi', () => ({ getRoleHypotheses: vi.fn(async () => []) }));

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
  clearProfileAtsAssessmentCache();
});

function ScoreProbe({ refreshKey }: { readonly refreshKey: string }) {
  const state = useProfileAtsAssessment({ refreshKey });
  return (
    <output>{state.loading ? 'loading' : String(state.assessment?.total.score ?? '—')}</output>
  );
}

function renderProbe(refreshKey: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ScoreProbe refreshKey={refreshKey} />));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function render(refreshKey: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ProfileAtsAssessment refreshKey={refreshKey} />));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const ASSESSMENT = { total: { score: 72, maximum: 100, status: 'measured' } };
const NO_BASIS = { version: null, roleTitle: null };

describe('ATS block loads on Profile open (owner, 02.11)', () => {
  it('calculates on mount without a «Рассчитать» button', async () => {
    api.getProfileAtsAssessment.mockResolvedValue({ assessment: ASSESSMENT, basis: NO_BASIS });
    const container = renderProbe('rev-1');
    await act(async () => undefined);
    expect(api.getProfileAtsAssessment).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('72');
  });

  it('shows the cached result at once for an unchanged profile and recomputes after a change', async () => {
    api.getProfileAtsAssessment.mockResolvedValue({ assessment: ASSESSMENT, basis: NO_BASIS });
    renderProbe('rev-1');
    await act(async () => undefined);
    const again = renderProbe('rev-1');
    expect(again.textContent).toBe('72');
    await act(async () => undefined);
    expect(api.getProfileAtsAssessment).toHaveBeenCalledTimes(1);
    renderProbe('rev-2');
    await act(async () => undefined);
    expect(api.getProfileAtsAssessment).toHaveBeenCalledTimes(2);
  });

  it('hides the «— из 100» scale when the assessment failed, keeping error and retry', async () => {
    api.getProfileAtsAssessment.mockRejectedValue(new Error('x'));
    const container = render('rev-1');
    await act(async () => undefined);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('из 100');
    expect(container.textContent).toContain('Повторить');
  });
});
