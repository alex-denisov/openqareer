import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { photoDistance, photoHash, samePhoto } from './photoHash';

/** Картинка с вертикальным градиентом и пятном: разные «лица» — разные пятна. */
function pixels(width: number, height: number, spotX: number, mirror = false): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const spot = Math.hypot(x - spotX * width, y - height / 2) < width / 5 ? 120 : 0;
      const value = Math.min(255, Math.round(((mirror ? width - x : x) / width) * 60 + (y / height) * 30) + spot);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return data;
}

const jpegOf = (spotX: number, size = 120, quality = 90) =>
  Buffer.from(
    jpeg.encode({ data: pixels(size, size, spotX), width: size, height: size }, quality).data,
  );
const pngOf = (spotX: number, size = 64) => {
  const png = new PNG({ width: size, height: size });
  png.data = pixels(size, size, spotX, true);
  return PNG.sync.write(png);
};

function deps(
  body: Buffer,
  headers: Record<string, string> = { 'content-type': 'image/jpeg' },
  status = 200,
) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      exaApiKey: undefined,
      lookupHost: async () => ['93.184.216.34'],
      fetch: (async (url: string) => {
        calls.push(url);
        return new Response(new Uint8Array(body), { status, headers });
      }) as unknown as typeof fetch,
    },
  };
}

describe('photo hash', () => {
  it('gives the same photo the same hash across size and recompression', async () => {
    const a = await photoHash('https://media.example.com/a.jpg', deps(jpegOf(0.3, 200, 95)).deps);
    const b = await photoHash('https://cdn.example.org/b.jpg', deps(jpegOf(0.3, 96, 60)).deps);
    expect(a).toMatch(/^[0-9a-f]{16}$/u);
    expect(samePhoto(a!, b!)).toBe(true);
  });

  it('tells different photos apart, including png', async () => {
    const a = await photoHash('https://media.example.com/a.jpg', deps(jpegOf(0.25)).deps);
    const b = await photoHash(
      'https://media.example.com/b.png',
      deps(pngOf(0.75), { 'content-type': 'image/png' }).deps,
    );
    expect(photoDistance(a!, b!)).toBeGreaterThan(20);
    expect(samePhoto(a!, b!)).toBe(false);
  });

  it('does not hash a flat placeholder image', async () => {
    const flat = Buffer.from(
      jpeg.encode({ data: Buffer.alloc(64 * 64 * 4, 200), width: 64, height: 64 }, 90).data,
    );
    expect(await photoHash('https://media.example.com/flat.jpg', deps(flat).deps)).toBeNull();
  });

  it('refuses private hosts, plain http, big bodies and non-images without downloading', async () => {
    const internal = deps(jpegOf(0.3));
    expect(
      await photoHash('https://intranet.example.com/a.jpg', {
        ...internal.deps,
        lookupHost: async () => ['10.0.0.5'],
      }),
    ).toBeNull();
    expect(await photoHash('http://media.example.com/a.jpg', internal.deps)).toBeNull();
    expect(internal.calls).toEqual([]);
    expect(
      await photoHash(
        'https://media.example.com/a.jpg',
        deps(jpegOf(0.3), { 'content-type': 'image/jpeg', 'content-length': '3000000' }).deps,
      ),
    ).toBeNull();
    expect(
      await photoHash(
        'https://media.example.com/a.jpg',
        deps(Buffer.from('<html>'), { 'content-type': 'text/html' }).deps,
      ),
    ).toBeNull();
    expect(
      await photoHash('https://media.example.com/a.jpg', deps(Buffer.alloc(2_100_000, 1)).deps),
    ).toBeNull();
  });
});
