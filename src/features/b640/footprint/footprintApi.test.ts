import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../coach/apiClient';
import { addFindingToProfile, removeFindingFromProfile } from './footprintApi';

vi.mock('../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../coach/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ID = 'b'.repeat(24);

describe('«В профиль» и его отмена (B382)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('сообщает, что факт уже был в профиле', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { audit: {}, alreadyInProfile: true } }));
    expect(await addFindingToProfile(ID)).toEqual({ alreadyInProfile: true });
    fetchMock.mockResolvedValueOnce(json({ data: { audit: {} } }));
    expect(await addFindingToProfile(ID)).toEqual({ alreadyInProfile: false });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/v1/candidate/footprint/findings/${ID}/profile-fact`,
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });

  it('отмена — DELETE того же адреса; сбой — ошибка', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { audit: {} } }));
    await removeFindingFromProfile(ID);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'x', message: 'x' } }, 409));
    await expect(removeFindingFromProfile(ID)).rejects.toThrow();
  });
});
