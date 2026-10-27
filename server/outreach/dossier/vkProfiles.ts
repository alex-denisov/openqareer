import type { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';

/**
 * Открытый профиль VK по нику без входа (B258). Замер с прода 27.10: страница
 * vk.com/<ник> отдаёт данные профиля в кэше предзагрузки (`users.get`): имя,
 * о себе, город, работу и фото. Instagram без входа уводит на страницу входа —
 * его здесь нет. Профили, закрытые владельцем, данных не отдают и пропускаются.
 */
export interface VkProfile {
  readonly nick: string;
  readonly fullName: string;
  /** Имя, о себе, статус, город, работа — текст для графа соответствия. */
  readonly text: string;
  readonly photoUrl: string | null;
}

interface VkDeps {
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 600_000;
const SEGMENT_CHARS = 80_000;
/** Без обычного браузера VK отдаёт заглушку «браузер устарел» вместо профиля. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function field(segment: string, name: string): string {
  const match = new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.){0,600})"`, 'u').exec(segment);
  if (!match) return '';
  try {
    return (JSON.parse(`"${match[1]}"`) as string).replace(/&#(\d{1,6});/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
  } catch {
    return '';
  }
}

/** Профиль владельца страницы — ответ `users.get` в кэше предзагрузки. */
export function parseVkProfile(html: string, nick: string): VkProfile | null {
  const start = html.indexOf('"method":"users.get"');
  if (start < 0) return null;
  const segment = html.slice(start, start + SEGMENT_CHARS);
  const own = segment.indexOf(`"screen_name":"${nick}"`);
  if (own < 0) return null;
  const first = field(segment, 'first_name');
  const last = field(segment, 'last_name');
  if (!first || !last) return null;
  const city = /"city":\{"id":\d+,"title":"((?:[^"\\]|\\.){1,80})"/u.exec(segment)?.[1] ?? '';
  const companies = [...segment.matchAll(/"company":"((?:[^"\\]|\\.){1,120})"/gu)]
    .map((match) => match[1]!)
    .slice(0, 10);
  const text = [
    `${first} ${last}`,
    field(segment, 'about'),
    field(segment, 'status'),
    field(segment, 'activities'),
    city,
    ...companies.map((name) => `в ${name}`),
  ]
    .filter(Boolean)
    .join('\n');
  const photo = field(segment, 'photo_200') || field(segment, 'photo_max');
  return {
    nick,
    fullName: `${first} ${last}`,
    text,
    photoUrl: photo.startsWith('https://') ? photo : null,
  };
}

async function readLimited(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks);
}

export type VkFetchResult = { profile: VkProfile | null; refused: boolean };

export async function fetchVkProfile(nick: string, deps: VkDeps): Promise<VkFetchResult> {
  if (!/^[A-Za-z][A-Za-z0-9_.]{4,31}$/u.test(nick)) return { profile: null, refused: false };
  const fetcher = deps.fetch ?? globalThis.fetch;
  const gate = deps.requestGate ?? sharedFootprintRequestGate;
  try {
    return await gate.run('vk.com', AbortSignal.timeout(REQUEST_TIMEOUT_MS), async () => {
      const response = await fetcher(`https://vk.com/${nick}`, {
        headers: {
          accept: 'text/html',
          'accept-language': 'ru-RU,ru;q=0.9',
          'user-agent': BROWSER_UA,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 403 || response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        return { profile: null, refused: true };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { profile: null, refused: false };
      }
      const charset =
        /charset=([\w-]+)/iu.exec(response.headers.get('content-type') ?? '')?.[1] ??
        'windows-1251';
      const html = new TextDecoder(charset).decode(await readLimited(response));
      return { profile: parseVkProfile(html, nick), refused: false };
    });
  } catch {
    return { profile: null, refused: true };
  }
}
