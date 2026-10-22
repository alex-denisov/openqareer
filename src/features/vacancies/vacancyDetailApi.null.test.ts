import { expect, it, vi } from 'vitest';

vi.mock('../coach/apiClient', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ data: null }))),
  readData: vi.fn(async () => null),
}));

const { fetchVacancyDetail } = await import('./vacancyDetailApi');

it('rejects an empty detail answer so the card shows «failed», not a crash (B510)', async () => {
  await expect(fetchVacancyDetail('c1')).rejects.toThrow();
});
