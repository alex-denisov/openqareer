import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readData: vi.fn(async (response: unknown) => response),
  onApiWrite: vi.fn((listener: () => void) => {
    writes.push(listener);
    return () => undefined;
  }),
}));
const writes = vi.hoisted((): Array<() => void> => []);
vi.mock('../../coach/apiClient', () => client);

import { getAppPreferences, preferredTheme } from './appPreferencesApi';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  writes.forEach((listener) => listener());
});

describe('appPreferencesApi', () => {
  it('одновременные чтения делят один запрос, следующее — новый', async () => {
    client.apiFetch.mockResolvedValue({ theme: 'dark', moneyCurrency: 'RUB' });
    const [theme, prefs] = await Promise.all([preferredTheme(), getAppPreferences()]);
    expect(theme).toBe('dark');
    expect(prefs).toMatchObject({ moneyCurrency: 'RUB' });
    expect(client.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('B773: экран n06 следом за оболочкой берёт её свежий ответ; через 10 с и после записи — новый запрос', async () => {
    vi.useFakeTimers();
    client.apiFetch.mockResolvedValue({ theme: 'dark', moneyCurrency: 'RUB' });
    await preferredTheme();
    vi.advanceTimersByTime(1_400);
    await getAppPreferences();
    expect(client.apiFetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(9_000);
    await getAppPreferences();
    expect(client.apiFetch).toHaveBeenCalledTimes(2);
    writes.forEach((listener) => listener());
    await getAppPreferences();
    expect(client.apiFetch).toHaveBeenCalledTimes(3);
  });

  it('сбой не запоминается: повтор идёт заново', async () => {
    client.apiFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(getAppPreferences()).rejects.toThrow('offline');
    client.apiFetch.mockResolvedValueOnce({ theme: null });
    await expect(getAppPreferences()).resolves.toEqual({ theme: null });
  });
});
