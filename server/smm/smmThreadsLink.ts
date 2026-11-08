/**
 * Ссылка на пост Threads → его текст из открытых метаданных страницы.
 * Без входа Threads отдаёт только первую часть ветки; остальное владелец
 * пришлёт снимком. Адрес проверяется до запроса: ходим только на threads.com/net.
 */

const THREADS_URL = /https:\/\/(?:www\.)?threads\.(?:com|net)\/[^\s<>"]+/i;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const THREADS_HOST = /(^|\.)threads\.(com|net)$/;

/** Только https на сам Threads: без логина в адресе и без чужого порта. */
function isThreadsTarget(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    THREADS_HOST.test(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port
  );
}

function redirectTarget(location: string | null, from: string): URL | null {
  if (!location) return null;
  try {
    const next = new URL(location, from);
    return isThreadsTarget(next) && !next.searchParams.has('error') ? next : null;
  } catch {
    return null;
  }
}

export function findThreadsUrl(text: string): string | null {
  const match = THREADS_URL.exec(text);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return isThreadsTarget(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`,
    'i',
  );
  const match = pattern.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

/** Текст поста или null, если Threads его не отдал (удалён, закрыт, требует входа). */
export async function fetchThreadsPost(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!findThreadsUrl(url)) return null;
  try {
    // Переходы идём сами: каждый адрес проверяется ДО запроса, чужой хост не получает даже GET.
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetchImpl(current, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; openqareer-smm/1.0)',
          Accept: 'text/html',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const next = redirectTarget(response.headers.get('location'), current);
        if (!next) return null;
        current = next.toString();
        continue;
      }
      return response.ok ? await postText(response) : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function postText(response: Response): Promise<string | null> {
  const finalUrl = response.url ? new URL(response.url) : null;
  if (finalUrl && (!isThreadsTarget(finalUrl) || finalUrl.searchParams.has('error'))) return null;
  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  const title = metaContent(html, 'og:title');
  const text = [title, description].filter(Boolean).join('\n').trim();
  return text.length >= 20 ? text : null;
}
