import { describe, expect, it } from 'vitest';
import { fetchBamboohrBoard } from './bamboohrBoardFetch';
import { normalizeAtsBoard } from './atsBoardAdapters';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('B628 — BambooHR с датой из карточки', () => {
  it('добавляет datePosted из /detail, и вакансия получает дату публикации', async () => {
    const fake = (async (url: string) => {
      if (url.endsWith('/careers/list'))
        return json({ result: [{ id: '88', jobOpeningName: 'Senior Go Developer' }] });
      if (url.endsWith('/careers/88/detail'))
        return json({ result: { jobOpening: { datePosted: '2026-11-01' } } });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const payload = await fetchBamboohrBoard('altenar', fake);
    const [vacancy] = normalizeAtsBoard('ats-bamboohr-altenar', payload, {
      observedAt: '2026-11-10T00:00:00.000Z',
      sourceName: 'Altenar',
    });
    expect(vacancy?.publishedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('карточка без ответа не роняет доску', async () => {
    const fake = (async (url: string) =>
      url.endsWith('/careers/list')
        ? json({ result: [{ id: '1', jobOpeningName: 'QA Engineer' }] })
        : new Response('', { status: 500 })) as unknown as typeof fetch;
    const payload = (await fetchBamboohrBoard('x', fake)) as { result: unknown[] };
    expect(payload.result).toHaveLength(1);
  });
});
