import { describe, expect, it, vi } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { FootprintRequestGate } from './requestScheduler';
import { createYoutubeAdapter, isYoutubeUrl, youtubeChannelQuery } from './youtubeAdapter';

const gate = () => new FootprintRequestGate({ wait: async () => undefined, now: () => 1_000 });
const NOW = () => new Date('2026-11-19T12:00:00.000Z');
const channel = (id: string) =>
  new Response(JSON.stringify({ items: [{ id, snippet: { title: 'Чужое название' } }] }), {
    status: 200,
  });

describe('B668: канал YouTube по ссылке кандидата', () => {
  it('узнаёт ссылки YouTube и переводит их в запрос channels.list', () => {
    expect(isYoutubeUrl('https://www.youtube.com/@msokolova')).toBe(true);
    expect(isYoutubeUrl('https://m.youtube.com/channel/UCabc')).toBe(true);
    expect(isYoutubeUrl('https://github.com/msokolova')).toBe(false);
    expect(isYoutubeUrl('https://youtube.com.evil.test/@x')).toBe(false);
    expect(youtubeChannelQuery('https://www.youtube.com/@msokolova')).toEqual({
      forHandle: '@msokolova',
    });
    expect(youtubeChannelQuery('https://youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({
      id: 'UC1234567890abcdefghijkl',
    });
    expect(youtubeChannelQuery('https://www.youtube.com/user/msokolova')).toEqual({
      forUsername: 'msokolova',
    });
    expect(youtubeChannelQuery('https://www.youtube.com/c/msokolova')).toEqual({
      forHandle: '@msokolova',
    });
    expect(youtubeChannelQuery('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(youtubeChannelQuery('https://www.youtube.com/@bad handle')).toBeNull();
  });

  it('канал есть: находка со ссылкой на канал и источником, без данных API в тексте', async () => {
    const fetchFixture = vi.fn(async () => channel('UC1234567890abcdefghijkl'));
    const adapter = createYoutubeAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      now: NOW,
      requestGate: gate(),
    });
    const findings = await adapter.run(
      { profileUrl: 'https://www.youtube.com/@msokolova' },
      new AbortController().signal,
    );
    const url = new URL(String((fetchFixture.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/channels');
    expect(url.searchParams.get('forHandle')).toBe('@msokolova');
    expect(url.searchParams.get('part')).toBe('id');
    expect(url.searchParams.has('key')).toBe(false);
    const init = (fetchFixture.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('fixture-key');
    expect(findings).toEqual([
      {
        adapter: 'youtube',
        kind: 'profile',
        url: 'https://www.youtube.com/@msokolova',
        title: 'Канал YouTube @msokolova',
        detail: 'Канал по вашей ссылке существует.',
        match: 'likely_self',
        observedAt: '2026-11-19T12:00:00.000Z',
        receipt: { method: 'GET', source: 'YouTube Data API', query: 'forHandle=@msokolova' },
      },
    ]);
    // Из ответа API ничего не храним: ни названия, ни id канала (правило 30 дней).
    expect(JSON.stringify(findings)).not.toMatch(/Чужое название|UC1234567890/u);
  });

  it('канала нет — находок нет; без ключа — источник не подключён; сбой API — ошибка источника', async () => {
    const empty = createYoutubeAdapter({
      apiKey: 'k',
      fetch: vi.fn(async () => new Response('{"items":[]}', { status: 200 })),
      now: NOW,
      requestGate: gate(),
    });
    const input = { profileUrl: 'https://www.youtube.com/@nobody' };
    expect(await empty.run(input, new AbortController().signal)).toEqual([]);

    const noKey = createYoutubeAdapter({ fetch: vi.fn(), requestGate: gate() });
    await expect(noKey.run(input, new AbortController().signal)).rejects.toMatchObject({
      failure: 'not_connected',
    });

    const broken = createYoutubeAdapter({
      apiKey: 'k',
      fetch: vi.fn(async () => new Response('quota', { status: 403 })),
      requestGate: gate(),
    });
    await expect(broken.run(input, new AbortController().signal)).rejects.toBeInstanceOf(
      FootprintSourceError,
    );
  });

  it('ответ больше предела — ошибка источника, тело не читается целиком', async () => {
    const huge = createYoutubeAdapter({
      apiKey: 'k',
      fetch: vi.fn(async () => new Response('x'.repeat(200 * 1024), { status: 200 })),
      requestGate: gate(),
    });
    await expect(
      huge.run({ profileUrl: 'https://www.youtube.com/@a' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
  });

  it('ссылка не на канал — к API не идёт', async () => {
    const fetchFixture = vi.fn();
    const adapter = createYoutubeAdapter({ apiKey: 'k', fetch: fetchFixture, requestGate: gate() });
    expect(
      await adapter.run({ profileUrl: 'https://www.youtube.com/watch?v=1' }, new AbortController().signal),
    ).toEqual([]);
    expect(fetchFixture).not.toHaveBeenCalled();
  });
});
