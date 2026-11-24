import { describe, expect, it, vi } from 'vitest';
import { createApplyRedirects } from './applyRedirect';

const to = (location: string | null, status = 302) =>
  new Response(null, { status, headers: location ? { location } : {} });
const START = 'https://grnh.se/abc';

describe('переход трекера (B787)', () => {
  it('раскрывает адрес, конечную страницу не запрашивает, результат помнит', async () => {
    const fetchImpl = vi.fn(async () => to('https://boards.greenhouse.io/acme/jobs/1'));
    const redirects = createApplyRedirects(fetchImpl as unknown as typeof fetch);
    const found = await Promise.all([
      redirects.resolve(START, 'c1'),
      redirects.resolve(START, 'c1'),
    ]);
    expect(found).toEqual(Array(2).fill('https://boards.greenhouse.io/acme/jobs/1'));
    expect(redirects.peek(START)).toBe(found[0]);
    await redirects.resolve(START, 'c1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://www.indeed.com/x',
    'https://www.linkedin.com/jobs/view/1',
    'http://grnh.se/abc',
    'https://grnh.se:8443/a',
    'https://127.0.0.1/',
    'https://u:p@grnh.se/a',
  ])('не открывает %s', async (url) => {
    const fetchImpl = vi.fn();
    const found = await createApplyRedirects(fetchImpl as unknown as typeof fetch).resolve(
      url,
      'c1',
    );
    expect([found, fetchImpl.mock.calls.length]).toEqual([null, 0]);
  });

  it.each([
    ['отказ площадки', () => to(null, 403)],
    ['http вместо https', () => to('http://acme.com/1')],
    ['кольцо трекеров', () => to(START)],
    [
      'сбой сети',
      () => {
        throw new Error('timeout');
      },
    ],
  ])('%s: неизвестно, сразу не повторяется', async (_, answer) => {
    const fetchImpl = vi.fn(async () => answer());
    const redirects = createApplyRedirects(fetchImpl as unknown as typeof fetch);
    expect(await redirects.resolve(START, 'c1')).toBeNull();
    const calls = fetchImpl.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(4);
    expect(await redirects.resolve(START, 'c1')).toBeNull();
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it('через час после сбоя пробует снова', async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => to(null, 503));
    const redirects = createApplyRedirects(fetchImpl as unknown as typeof fetch, () => time);
    await redirects.resolve(START, 'c1');
    time = 60 * 60 * 1000 + 1;
    await redirects.resolve(START, 'c1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('двадцать обращений к трекеру в минуту на всех; сверх — без запроса и без памяти о сбое', async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => to('https://acme.com/1'));
    const redirects = createApplyRedirects(fetchImpl as unknown as typeof fetch, () => time);
    const read = (index: number) =>
      redirects.resolve(`https://s${index}.appcast.io/${index}`, `c${index}`);
    for (let index = 0; index < 20; index += 1) await read(index);
    expect(await read(20)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    time = 60_000;
    expect(await read(20)).toBe('https://acme.com/1');
  });

  it('у кандидата идёт один переход; повтор того же адреса ждёт его', async () => {
    let active = 0;
    let most = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((done) => setTimeout(done, 5));
      active -= 1;
      return to('https://acme.com/1');
    });
    const redirects = createApplyRedirects(fetchImpl as unknown as typeof fetch);
    await Promise.all(
      [START, START, `${START}d`, `${START}e`].map((url) => redirects.resolve(url, 'c1')),
    );
    expect([most, fetchImpl.mock.calls.length]).toEqual([1, 3]);
  });
});
