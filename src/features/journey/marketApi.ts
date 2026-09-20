import { z } from 'zod';
import { apiFetch } from '../coach/apiClient';
import type { MarketVacancySample } from '../workspace/workspaceStorage';

const responseSchema = z.object({
  data: z.object({
    source: z.literal('hh'),
    query: z.string(),
    found: z.number().int().nonnegative(),
    fetchedAt: z.string().datetime(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        company: z.string(),
        location: z.string(),
        sourceUrl: z.string().url(),
        publishedAt: z.string().nullable(),
        salary: z
          .object({
            from: z.number().nonnegative().nullable(),
            to: z.number().nonnegative().nullable(),
            currency: z.string(),
            gross: z.boolean(),
          })
          .nullable(),
      }),
    ),
  }),
});

export async function fetchHhMarketSample(
  text: string,
): Promise<MarketVacancySample> {
  const query = new URLSearchParams({ text, perPage: '12' });
  // Через `apiFetch`: голый `fetch` не работает на tauri-origin (PRB-041).
  const response = await apiFetch(`/api/v1/market/hh?${query}`);
  if (!response.ok) {
    throw new Error('hh_market_unavailable');
  }
  return responseSchema.parse(await response.json()).data;
}
