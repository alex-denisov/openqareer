import { describe, expect, it } from 'vitest';
import { encodeWav, mixToMono, splitChunks } from './audioChunks';

describe('audioChunks', () => {
  it('mixes stereo to mono by averaging', () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 0.5])]);
    expect(Array.from(mono)).toEqual([0.5, 0.25]);
  });

  it('splits into equal pieces with the last one shorter, times in ms', () => {
    const chunks = splitChunks(new Float32Array(25), 10, 1);
    expect(chunks.map((chunk) => [chunk.index, chunk.startMs, chunk.durationMs])).toEqual([
      [0, 0, 1000],
      [1, 1000, 1000],
      [2, 2000, 500],
    ]);
  });

  it('a 5-minute piece at 16 kHz stays far below the 25 MB segment cap', () => {
    const bytes = encodeWav(new Float32Array(16_000 * 300)).byteLength;
    expect(bytes).toBe(44 + 16_000 * 300 * 2);
    expect(bytes).toBeLessThan(25 * 1024 * 1024);
  });

  it('writes a valid 16-bit mono WAV header and clamps samples', () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2, 0]), 16_000));
    const text = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
