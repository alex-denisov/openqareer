import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readVacancyPage, type PageReadResult } from '../vacancies/ownVacancy/pageReader';
import { extractArticle, extractTelegramPost } from './smmLinkExtract';
import { findLink, linkKind, readLink, refusalText } from './smmLinkReader';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', 'links', name), 'utf8');

const page = (name: string) => async (): Promise<PageReadResult> => ({
  ok: true,
  html: fixture(name),
});

describe('findLink', () => {
  it('takes the first http(s) link and keeps the rest as the owner topic', () => {
    expect(findLink('Тема: отказы без причины https://vc.ru/hr/123. Разбери')).toEqual({
      url: 'https://vc.ru/hr/123',
      rest: 'Тема: отказы без причины Разбери',
    });
    expect(findLink('без ссылки')).toBeNull();
    expect(findLink('ftp://example.com/x')).toBeNull();
  });

  it('knows each kind of source', () => {
    const kind = (url: string) => linkKind(new URL(url));
    expect(kind('https://www.threads.com/@a/post/1')).toBe('threads');
    expect(kind('https://t.me/career/42')).toBe('telegram');
    expect(kind('https://x.com/a/status/1')).toBe('x');
    expect(kind('https://twitter.com/a/status/1')).toBe('x');
    expect(kind('https://www.linkedin.com/posts/a-1')).toBe('linkedin');
    expect(kind('https://habr.com/ru/articles/1/')).toBe('page');
  });
});

describe('extractors on saved pages', () => {
  it('Habr: title from og, text from <article> without navigation', () => {
    const out = extractArticle(fixture('habr-article.html'));
    expect(out?.title).toBe('Почему мой отклик читают за шесть секунд');
    expect(out?.author).toBe('Иван Петров');
    expect(out?.text).toContain('первые строки отклика решают всё');
    expect(out?.text).toContain('- Начните с результата');
    expect(out?.text).not.toContain('Моя лента');
  });

  it('vc.ru: author from meta, body from the article blocks', () => {
    const out = extractArticle(fixture('vc-article.html'));
    expect(out?.author).toBe('Мария Соколова');
    expect(out?.text).toContain('пять приглашений');
    expect(out?.text).not.toContain('Популярное за неделю');
  });

  it('Substack: an author link in meta is replaced by the JSON-LD name', () => {
    const out = extractArticle(fixture('substack-post.html'));
    expect(out?.author).toBe('Anna Lee');
    expect(out?.text).toContain('reply rate doubled');
  });

  it('personal site: text from <main>', () => {
    const out = extractArticle(fixture('personal-site.html'));
    expect(out?.title).toBe('Заметки о найме — блог Олега');
    expect(out?.text).toContain('почему отказ пришёл без объяснений');
  });

  it('a login wall is not a page text', () => {
    expect(extractArticle(fixture('login-wall.html'))).toBeNull();
  });

  it('caps a long text', () => {
    const long = `<html><body><article><p>${'слово '.repeat(3_000)}</p></article></body></html>`;
    expect(extractArticle(long)!.text.length).toBeLessThanOrEqual(4_001);
  });

  it('Telegram: the exact post from the public channel view, not its neighbour', () => {
    const out = extractTelegramPost(fixture('telegram-channel.html'), 'career_nowater', '42');
    expect(out?.author).toBe('Карьера без воды');
    expect(out?.text).toContain('Отказ — это не оценка вас.');
    expect(out?.text).not.toContain('зарплатные вилки');
    expect(
      extractTelegramPost(fixture('telegram-channel.html'), 'career_nowater', '99'),
    ).toBeNull();
  });
});

describe('readLink', () => {
  it('Telegram goes through the public t.me/s view', async () => {
    const readPage = vi.fn(page('telegram-channel.html'));
    const read = await readLink('https://t.me/career_nowater/42', { readPage });
    expect(readPage).toHaveBeenCalledWith('https://t.me/s/career_nowater/42');
    expect(read.ok).toBe(true);
  });

  it('X is refused without a request: no open way to read a post', async () => {
    const readPage = vi.fn(page('habr-article.html'));
    const read = await readLink('https://x.com/hiring_notes/status/1890000000000000000', {
      readPage,
    });
    expect(readPage).not.toHaveBeenCalled();
    if (read.ok) throw new Error('unexpected');
    expect(refusalText(read)).toMatch(/X.*снимок экрана/u);
  });

  it('Threads keeps its own reader', async () => {
    const fetchThreads = vi.fn(async () => 'Текст поста из Threads, достаточно длинный');
    const readPage = vi.fn(page('habr-article.html'));
    const read = await readLink('https://www.threads.com/@a/post/ABC', { readPage, fetchThreads });
    expect(fetchThreads).toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
    expect(read.ok).toBe(true);
  });

  it('an unreadable page is an honest refusal asking for a screenshot', async () => {
    const read = await readLink('https://medium.com/@a/post-1', {
      readPage: async () => ({ ok: false, reason: 'failed' }),
    });
    expect(read).toMatchObject({ ok: false, reason: 'unreadable' });
    if (read.ok) throw new Error('unexpected');
    expect(refusalText(read)).toBe(
      'Не смог прочитать medium.com, текст я не видел. Пришлите снимок экрана.',
    );
  });

  it('LinkedIn is closed for reading and says so', async () => {
    const read = await readLink('https://www.linkedin.com/posts/a-1', {
      readPage: async () => ({ ok: false, reason: 'site_closed' }),
    });
    if (read.ok) throw new Error('unexpected');
    expect(refusalText(read)).toMatch(/LinkedIn.*снимок экрана/u);
  });
});

describe('SSRF guard (real page reader, fake network)', () => {
  const guarded = (resolve: (host: string) => Promise<readonly string[]>) => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>'));
    const readPage = (url: string) => readVacancyPage(url, { fetchImpl, resolve });
    return { fetchImpl, readPage };
  };

  it.each([
    'http://127.0.0.1/admin',
    'http://localhost:3210/api',
    'http://10.0.0.5/',
    'http://[::1]/',
    'https://example.com:8443/',
    'http://user:pass@example.com/',
  ])('never sends a request to %s', async (url) => {
    const { fetchImpl, readPage } = guarded(async () => ['93.184.216.34']);
    const read = await readLink(url, { readPage });
    expect(read.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a public name that resolves to a private address is refused', async () => {
    const { fetchImpl, readPage } = guarded(async () => ['192.168.1.10']);
    const read = await readLink('https://rebind.example.com/post', { readPage });
    expect(read.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a redirect to a private address is not followed', async () => {
    const resolve = async (host: string) =>
      host === 'evil.example.com' ? ['127.0.0.1'] : ['93.184.216.34'];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.com/x' },
      });
    });
    const read = await readLink('https://blog.example.com/post', {
      readPage: (url) => readVacancyPage(url, { fetchImpl, resolve }),
    });
    expect(read.ok).toBe(false);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://evil.example.com/x',
    );
  });
});
