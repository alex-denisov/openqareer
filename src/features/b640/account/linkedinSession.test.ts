import { describe, expect, it, vi } from 'vitest';

const li = vi.hoisted(() => ({
  start: vi.fn(),
  persist: vi.fn(),
  notice: vi.fn(() => 'Из LinkedIn сохранено 3 факта.'),
}));
vi.mock('../../connections/linkedinBackgroundImport', () => ({
  startLinkedInBackgroundImport: li.start,
}));
vi.mock('../../connections/AccountConnections', () => ({
  persistLinkedInCapture: li.persist,
  nativeImportNotice: li.notice,
}));

import { refreshLinkedInProfile } from './linkedinSession';

describe('refreshLinkedInProfile', () => {
  it('фоновый импорт сохраняет снимок; итог — текст сохранения или объяснение сбоя', async () => {
    li.persist.mockResolvedValue({ saved: 3 });
    li.start.mockImplementationOnce(async (persist: (capture: unknown) => Promise<string>) => ({
      phase: 'done',
      message: await persist({ profile: 'снимок' }),
    }));
    await expect(refreshLinkedInProfile()).resolves.toEqual({
      ok: true,
      message: 'Из LinkedIn сохранено 3 факта.',
    });
    expect(li.persist).toHaveBeenCalledWith({ profile: 'снимок' });
    expect(li.notice).toHaveBeenCalledWith('linkedin', { saved: 3 });
    li.start.mockResolvedValueOnce({ phase: 'failed', message: 'Профиль не изменился.' });
    await expect(refreshLinkedInProfile()).resolves.toEqual({
      ok: false,
      message: 'Профиль не изменился.',
    });
  });
});
