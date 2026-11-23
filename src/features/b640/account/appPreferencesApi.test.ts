import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readData: vi.fn(async (response: unknown) => response),
}));
vi.mock('../../coach/apiClient', () => client);

import { getAppPreferences, preferredTheme } from './appPreferencesApi';

afterEach(() => vi.clearAllMocks());

describe('appPreferencesApi', () => {
  it('одновременные чтения делят один запрос, следующее — новый', async () => {
    client.apiFetch.mockResolvedValue({ theme: 'dark', moneyCurrency: 'RUB' });
    const [theme, prefs] = await Promise.all([preferredTheme(), getAppPreferences()]);
    expect(theme).toBe('dark');
    expect(prefs).toMatchObject({ moneyCurrency: 'RUB' });
    expect(client.apiFetch).toHaveBeenCalledTimes(1);
    await getAppPreferences();
    expect(client.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('сбой не запоминается: повтор идёт заново', async () => {
    client.apiFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(getAppPreferences()).rejects.toThrow('offline');
    client.apiFetch.mockResolvedValueOnce({ theme: null });
    await expect(getAppPreferences()).resolves.toEqual({ theme: null });
  });
});
