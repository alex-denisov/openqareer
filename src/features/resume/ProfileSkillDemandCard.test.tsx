// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleSkillDemandResponse } from '../skills/roleSkillDemandApi';

const getRoleSkillDemand = vi.fn<() => Promise<RoleSkillDemandResponse>>();
vi.mock('../skills/roleSkillDemandApi', () => ({ getRoleSkillDemand: () => getRoleSkillDemand() }));

const { ProfileSkillDemandCard } = await import('./ProfileSkillDemandCard');

const disposers: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  getRoleSkillDemand.mockReset();
});

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProfileSkillDemandCard candidateId="c1" onOpen={vi.fn()} />));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const ready: RoleSkillDemandResponse = {
  state: 'ready',
  roles: [
    {
      roleTitle: 'VP of Engineering',
      sampleSize: 49,
      observedAt: '2026-11-01T10:00:00.000Z',
      skills: [
        { name: 'Kubernetes', vacancies: 30, inProfile: false },
        { name: 'AWS', vacancies: 25, inProfile: true },
      ],
    },
  ],
};

describe('ProfileSkillDemandCard', () => {
  it('shows what vacancies of each role require, with sample size, date and profile presence', async () => {
    getRoleSkillDemand.mockResolvedValue(ready);
    const view = await render();
    const text = view.textContent ?? '';
    expect(text).toContain('Проверка навыков');
    expect(text).toContain('VP of Engineering');
    expect(text).toContain('49 вакансий');
    expect(text).toContain('01.11.2026');
    expect(text).toContain('Kubernetes');
    expect(text).toContain('30 из 49');
    expect(text).toContain('нет в профиле');
    expect(text).toContain('есть в профиле');
    expect(text).not.toContain('недостаточно');
  });

  it('is hidden when no role has enough vacancies', async () => {
    getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    const view = await render();
    expect(view.textContent).toBe('');
  });

  it('stays hidden while the summary is computed and shows it once ready', async () => {
    getRoleSkillDemand
      .mockResolvedValueOnce({ state: 'pending', roles: [] })
      .mockResolvedValue(ready);
    const view = await render();
    expect(view.textContent).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(view.textContent).toContain('VP of Engineering');
  });

  it('is hidden when the request fails', async () => {
    getRoleSkillDemand.mockRejectedValue(new Error('network'));
    const view = await render();
    expect(view.textContent).toBe('');
  });
});
