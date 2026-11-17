import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  normalizeProfilePhoto,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  ProfilePhotoError,
} from './profilePhoto';

type Paint = (x: number, y: number) => [number, number, number, number];

function rgba(width: number, height: number, paint: Paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

const red: Paint = () => [220, 20, 20, 255];

function jpegOf(width: number, height: number, paint: Paint = red): Buffer {
  return jpeg.encode(rgba(width, height, paint), 90).data;
}

function pngOf(width: number, height: number, paint: Paint = red): Buffer {
  const png = new PNG({ width, height });
  png.data = rgba(width, height, paint).data;
  return PNG.sync.write(png);
}

/** APP1 с EXIF: ориентация и «тайный» текст, который не должен пережить очистку. */
function withExif(image: Buffer, orientation: number): Buffer {
  const secret = Buffer.from('GPS-SECRET-55.7558,37.6173');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, secret]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([image.subarray(0, 2), head, payload, image.subarray(2)]);
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProfilePhotoError) return error.code;
    throw error;
  }
  return 'ok';
}

describe('normalizeProfilePhoto', () => {
  it('принимает JPEG и отдаёт JPEG без метаданных', () => {
    const source = withExif(jpegOf(200, 120), 1);
    expect(source.includes('GPS-SECRET')).toBe(true);
    const photo = normalizeProfilePhoto(source);
    expect(photo.mime).toBe('image/jpeg');
    expect([photo.width, photo.height]).toEqual([200, 120]);
    expect(photo.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(photo.bytes.includes('GPS-SECRET')).toBe(false);
    expect(photo.bytes.includes('Exif')).toBe(false);
  });

  it('принимает PNG, прозрачное кладёт на белое', () => {
    const photo = normalizeProfilePhoto(pngOf(100, 100, () => [0, 0, 0, 0]));
    expect(photo.mime).toBe('image/jpeg');
    const pixels = jpeg.decode(photo.bytes, { useTArray: true }).data;
    expect(pixels[0]).toBeGreaterThan(240);
    expect(pixels[1]).toBeGreaterThan(240);
  });

  it('уменьшает большое фото до предела по длинной стороне, пропорции сохраняет', () => {
    const photo = normalizeProfilePhoto(jpegOf(1600, 800));
    expect([photo.width, photo.height]).toEqual([PHOTO_MAX_SIDE, PHOTO_MAX_SIDE / 2]);
  });

  it('учитывает поворот из метаданных: снимок боком становится вертикальным', () => {
    const left: Paint = (x) => (x < 100 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    const photo = normalizeProfilePhoto(withExif(jpegOf(200, 100, left), 6));
    expect([photo.width, photo.height]).toEqual([100, 200]);
    const pixels = jpeg.decode(photo.bytes, { useTArray: true }).data;
    const at = (x: number, y: number) => pixels[(y * 100 + x) * 4];
    // Ориентация 6: левый край исходника оказывается сверху.
    expect(at(50, 20)).toBeGreaterThan(200);
    expect(at(50, 180)).toBeLessThan(60);
  });

  it('тип определяет по содержимому, а не по тому, как файл назвали', () => {
    expect(
      codeOf(() => normalizeProfilePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('photo_format');
    expect(
      codeOf(() => normalizeProfilePhoto(Buffer.from('GIF89a' + 'x'.repeat(64), 'latin1'))),
    ).toBe('photo_format');
    expect(codeOf(() => normalizeProfilePhoto(Buffer.from('%PDF-1.7 ' + 'x'.repeat(64))))).toBe(
      'photo_format',
    );
    expect(
      codeOf(() =>
        normalizeProfilePhoto(Buffer.from('RIFFxxxxWEBPVP8 ' + 'x'.repeat(64), 'latin1')),
      ),
    ).toBe('photo_format');
  });

  it('отклоняет пустой и слишком тяжёлый файл', () => {
    expect(codeOf(() => normalizeProfilePhoto(Buffer.alloc(0)))).toBe('photo_format');
    const heavy = Buffer.concat([jpegOf(10, 10), Buffer.alloc(PHOTO_MAX_BYTES)]);
    expect(codeOf(() => normalizeProfilePhoto(heavy))).toBe('photo_too_large');
  });

  it('отклоняет битый файл с верной сигнатурой', () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    expect(codeOf(() => normalizeProfilePhoto(broken))).toBe('photo_unreadable');
    const png = pngOf(80, 80);
    expect(codeOf(() => normalizeProfilePhoto(png.subarray(0, png.length - 30)))).toBe(
      'photo_unreadable',
    );
  });

  it('отклоняет слишком маленькое фото и «бомбу» по размеру в пикселях до распаковки', () => {
    expect(codeOf(() => normalizeProfilePhoto(jpegOf(40, 40)))).toBe('photo_too_small');
    const bomb = pngOf(64, 64);
    // IHDR объявляет 60000×60000: файл отклоняется по заголовку, без распаковки.
    bomb.writeUInt32BE(60_000, 16);
    bomb.writeUInt32BE(60_000, 20);
    expect(codeOf(() => normalizeProfilePhoto(bomb))).toBe('photo_too_many_pixels');
  });

  it('чересстрочный PNG не разбирает: у него нет потолка на распаковку', () => {
    const interlaced = pngOf(80, 80);
    interlaced[28] = 1;
    expect(codeOf(() => normalizeProfilePhoto(interlaced))).toBe('photo_unreadable');
  });

  it('потолок по пикселям — два мегапикселя: больше экран не отправляет', () => {
    expect(codeOf(() => normalizeProfilePhoto(jpegOf(1400, 1400)))).toBe('ok');
    expect(codeOf(() => normalizeProfilePhoto(jpegOf(1600, 1300)))).toBe('photo_too_many_pixels');
  });

  it('у каждой ошибки есть текст для кандидата', () => {
    for (const run of [
      () => normalizeProfilePhoto(Buffer.from('nope')),
      () => normalizeProfilePhoto(jpegOf(40, 40)),
    ]) {
      try {
        run();
      } catch (error) {
        expect((error as Error).message).toMatch(/[А-Яа-я]/u);
      }
    }
  });
});
