import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';
import type { DossierDeps } from './collectRecruiterDossier';
import { isPublicCompanyDomain } from './companyPages';
import { pinnedFetch } from './pinnedFetch';

/**
 * Отпечаток фото (dHash, 64 бита) как признак того же человека (B258): фото
 * LinkedIn против фото Telegram, VK, GitHub, профилей Maigret. Хранится только
 * отпечаток — само изображение не сохраняется и кандидату не показывается.
 */
const MAX_PHOTO_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
/**
 * Замер 27.10 на живых фото: тот же снимок в другом размере — 0 бит из 64,
 * тот же человек в VK и Telegram — 9, разные люди — от 21.
 */
export const SAME_PHOTO_MAX_DISTANCE = 10;
/** Заглушка без деталей (однотонный аватар) не признак человека. */
const MIN_CONTRAST = 6;

type Gray = {
  readonly width: number;
  readonly height: number;
  readonly luma: (x: number, y: number) => number;
};

/** Аватар — сотни точек; больше — не фото профиля, а риск распаковать в гигабайты. */
const MAX_PIXELS = 4_000_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Размер PNG из заголовка IHDR — до распаковки: файл в 100 КБ может заявить 10000×10000. */
function pngFits(body: Buffer): boolean {
  return body.length >= 24 && body.readUInt32BE(16) * body.readUInt32BE(20) <= MAX_PIXELS;
}

function decode(body: Buffer): Gray | null {
  try {
    const isPng = body.subarray(0, 8).equals(PNG_MAGIC);
    const isJpeg = body[0] === 0xff && body[1] === 0xd8;
    if (isPng && !pngFits(body)) return null;
    if (!isPng && !isJpeg) return null;
    const image = isPng
      ? PNG.sync.read(body)
      : jpeg.decode(body, { useTArray: true, maxResolutionInMP: MAX_PIXELS / 1_000_000, maxMemoryUsageInMB: 64 });
    const { width, height, data } = image;
    if (!width || !height) return null;
    return {
      width,
      height,
      luma: (x, y) => {
        const at = (y * width + x) * 4;
        return 0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!;
      },
    };
  } catch {
    return null;
  }
}

/** Средняя яркость клетки сетки 9×8 по всем её пикселям. */
function grid(image: Gray): number[] {
  const cells: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const x0 = Math.floor((col * image.width) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * image.width) / 9));
      const y0 = Math.floor((row * image.height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * image.height) / 8));
      const step = Math.max(1, Math.floor((x1 - x0) / 16));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          sum += image.luma(x, y);
          count += 1;
        }
      }
      cells.push(sum / count);
    }
  }
  return cells;
}

export function dHash(image: Gray): string | null {
  const cells = grid(image);
  if (Math.max(...cells) - Math.min(...cells) < MIN_CONTRAST) return null;
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      bits = (bits << 1n) | (cells[row * 9 + col]! > cells[row * 9 + col + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function photoDistance(left: string, right: string): number {
  let diff = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  for (; diff; diff &= diff - 1n) count += 1;
  return count;
}

export function samePhoto(left: string, right: string): boolean {
  return photoDistance(left, right) <= SAME_PHOTO_MAX_DISTANCE;
}

async function readBounded(response: Response): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Хост фото, ответивший отказом, не спрашивается час — как сайты профилей. */
const REFUSAL_COOLDOWN_MS = 3_600_000;
const REFUSED_UNTIL = new Map<string, number>();

/** Для тестов: сброс отказов между сценариями. */
export function resetPhotoRefusals(): void {
  REFUSED_UNTIL.clear();
}

async function publicHttps(url: string, deps: DossierDeps): Promise<URL | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.port) return null;
    if ((REFUSED_UNTIL.get(parsed.hostname) ?? 0) > Date.now()) return null;
    return (await isPublicCompanyDomain(parsed.hostname.toLowerCase(), deps)) ? parsed : null;
  } catch {
    return null;
  }
}

/** Отпечаток фото по публичной ссылке https; любая ошибка — нет отпечатка, а не отказ сбора. */
export async function photoHash(url: string, deps: DossierDeps): Promise<string | null> {
  const fetcher = deps.fetch ?? pinnedFetch;
  const gate = deps.requestGate ?? sharedFootprintRequestGate;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await publicHttps(current, deps);
    if (!target) return null;
    try {
      const next = await gate.run(
        target.hostname,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        async () => {
          const response = await fetcher(target.href, {
            headers: { accept: 'image/jpeg,image/png', 'user-agent': 'openqareer-contact-check' },
            redirect: 'manual',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          const location = response.headers.get('location');
          if (response.status >= 300 && response.status < 400 && location) {
            await response.body?.cancel().catch(() => undefined);
            return { redirect: new URL(location, target).href };
          }
          if (response.status === 403 || response.status === 429) {
            await response.body?.cancel().catch(() => undefined);
            REFUSED_UNTIL.set(target.hostname, Date.now() + REFUSAL_COOLDOWN_MS);
            return { hash: null };
          }
          const type = response.headers.get('content-type') ?? '';
          const length = Number(response.headers.get('content-length') ?? 0);
          if (!response.ok || !/^image\/(?:jpe?g|png)/u.test(type) || length > MAX_PHOTO_BYTES) {
            await response.body?.cancel().catch(() => undefined);
            return { hash: null };
          }
          const body = await readBounded(response);
          const image = body ? decode(body) : null;
          return { hash: image ? dHash(image) : null };
        },
      );
      if ('hash' in next) return next.hash ?? null;
      current = next.redirect;
    } catch {
      return null;
    }
  }
  return null;
}
