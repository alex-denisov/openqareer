import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * B666: фото профиля из файла кандидата. Файлу не верим: тип определяем по
 * содержимому, размеры — по заголовку до распаковки, а в хранилище кладём
 * заново собранный JPEG. Пересборка убирает метаданные снимка (EXIF, GPS,
 * превью) и всё, что в файле лежало помимо картинки.
 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 640;
const PHOTO_MIN_SIDE = 64;
const PHOTO_MAX_PIXELS = 25_000_000;
const JPEG_QUALITY = 86;

export type ProfilePhotoErrorCode =
  | 'photo_format'
  | 'photo_too_large'
  | 'photo_too_small'
  | 'photo_too_many_pixels'
  | 'photo_unreadable';

const MESSAGES: Record<ProfilePhotoErrorCode, string> = {
  photo_format: 'Подойдёт фото в JPEG или PNG.',
  photo_too_large: 'Фото больше 5 МБ.',
  photo_too_small: 'Фото меньше 64 пикселей по стороне.',
  photo_too_many_pixels: 'Фото слишком большое: уменьшите его до 5000 пикселей по стороне.',
  photo_unreadable: 'Файл не открылся как фото.',
};

export class ProfilePhotoError extends Error {
  constructor(readonly code: ProfilePhotoErrorCode) {
    super(MESSAGES[code]);
  }
}

export interface NormalizedPhoto {
  readonly bytes: Buffer;
  readonly mime: 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

interface Pixels {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function kindOf(bytes: Buffer): 'jpeg' | 'png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  return null;
}

function assertPixelBudget(width: number, height: number): void {
  if (!(width > 0 && height > 0)) throw new ProfilePhotoError('photo_unreadable');
  if (width * height > PHOTO_MAX_PIXELS) throw new ProfilePhotoError('photo_too_many_pixels');
}

/** Размеры JPEG из маркера кадра (SOF), без распаковки. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame)
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** Ориентация из EXIF (тег 0x0112); 1 — как есть. Нужна, чтобы снимок с телефона не лёг боком. */
function exifOrientation(exif: Uint8Array | undefined): number {
  if (!exif || exif.length < 16) return 1;
  const view = Buffer.from(exif.buffer, exif.byteOffset, exif.byteLength);
  const start = [0, 1, 2, 6].find((at) =>
    ['II', 'MM'].includes(view.toString('latin1', at, at + 2)),
  );
  if (start === undefined) return 1;
  const little = view.toString('latin1', start, start + 2) === 'II';
  const u16 = (at: number) => (little ? view.readUInt16LE(at) : view.readUInt16BE(at));
  const u32 = (at: number) => (little ? view.readUInt32LE(at) : view.readUInt32BE(at));
  try {
    const directory = start + u32(start + 4);
    const count = Math.min(u16(directory), 64);
    for (let index = 0; index < count; index += 1) {
      const entry = directory + 2 + index * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    return 1;
  }
  return 1;
}

function decodeJpeg(bytes: Buffer): { pixels: Pixels; orientation: number } {
  const size = jpegSize(bytes);
  if (!size) throw new ProfilePhotoError('photo_unreadable');
  assertPixelBudget(size.width, size.height);
  try {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: PHOTO_MAX_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 512,
    });
    const exif = (decoded as { exifBuffer?: Uint8Array }).exifBuffer;
    return { pixels: decoded, orientation: exifOrientation(exif) };
  } catch {
    throw new ProfilePhotoError('photo_unreadable');
  }
}

function decodePng(bytes: Buffer): { pixels: Pixels; orientation: number } {
  assertPixelBudget(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  try {
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    return { pixels: decoded, orientation: 1 };
  } catch {
    throw new ProfilePhotoError('photo_unreadable');
  }
}

/** Откуда в исходнике брать точку повёрнутого изображения. */
function sourcePoint(
  orientation: number,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  switch (orientation) {
    case 2:
      return [w - 1 - x, y];
    case 3:
      return [w - 1 - x, h - 1 - y];
    case 4:
      return [x, h - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [y, h - 1 - x];
    case 7:
      return [w - 1 - y, h - 1 - x];
    case 8:
      return [w - 1 - y, x];
    default:
      return [x, y];
  }
}

interface Frame {
  readonly source: Pixels;
  readonly orientation: number;
  readonly fullWidth: number;
  readonly fullHeight: number;
  /** Сколько точек исходника приходится на одну точку результата по стороне. */
  readonly step: number;
}

/** Средний цвет блока исходника под одной точкой результата; прозрачное ложится на белое. */
function blockColor(frame: Frame, x: number, y: number): [number, number, number] {
  const { source, orientation, fullWidth, fullHeight, step } = frame;
  const x0 = Math.floor(x * step);
  const y0 = Math.floor(y * step);
  const x1 = Math.min(fullWidth, Math.max(x0 + 1, Math.floor((x + 1) * step)));
  const y1 = Math.min(fullHeight, Math.max(y0 + 1, Math.floor((y + 1) * step)));
  const sum = [0, 0, 0];
  for (let sy = y0; sy < y1; sy += 1) {
    for (let sx = x0; sx < x1; sx += 1) {
      const [px, py] = sourcePoint(orientation, sx, sy, source.width, source.height);
      const at = (py * source.width + px) * 4;
      const alpha = source.data[at + 3] / 255;
      sum[0] += source.data[at] * alpha + 255 * (1 - alpha);
      sum[1] += source.data[at + 1] * alpha + 255 * (1 - alpha);
      sum[2] += source.data[at + 2] * alpha + 255 * (1 - alpha);
    }
  }
  const count = (x1 - x0) * (y1 - y0);
  return [Math.round(sum[0] / count), Math.round(sum[1] / count), Math.round(sum[2] / count)];
}

/**
 * Поворот по ориентации, уменьшение до предела усреднением блоков и белая
 * подложка под прозрачное. Возвращает RGBA для кодировщика JPEG.
 */
function render(source: Pixels, orientation: number): Pixels {
  const turned = orientation >= 5;
  const fullWidth = turned ? source.height : source.width;
  const fullHeight = turned ? source.width : source.height;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(fullWidth, fullHeight));
  const width = Math.max(1, Math.round(fullWidth * scale));
  const height = Math.max(1, Math.round(fullHeight * scale));
  const frame: Frame = { source, orientation, fullWidth, fullHeight, step: 1 / scale };
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([...blockColor(frame, x, y), 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/** Проверяет файл кандидата и возвращает очищенное фото для хранения. */
export function normalizeProfilePhoto(input: Buffer): NormalizedPhoto {
  if (input.length > PHOTO_MAX_BYTES) throw new ProfilePhotoError('photo_too_large');
  const kind = kindOf(input);
  if (!kind) throw new ProfilePhotoError('photo_format');
  const { pixels, orientation } = kind === 'jpeg' ? decodeJpeg(input) : decodePng(input);
  if (Math.min(pixels.width, pixels.height) < PHOTO_MIN_SIDE) {
    throw new ProfilePhotoError('photo_too_small');
  }
  const image = render(pixels, orientation);
  const encoded = jpeg.encode(
    { data: Buffer.from(image.data), width: image.width, height: image.height },
    JPEG_QUALITY,
  );
  return { bytes: encoded.data, mime: 'image/jpeg', width: image.width, height: image.height };
}
