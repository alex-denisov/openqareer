/**
 * B751, I4c: файл записи в браузере — моно 16 кГц, куски по 5 минут в WAV (~9,6 МБ при
 * потолке сегмента 25 МБ). Аудио не хранится ни здесь, ни на сервере: куски уходят на
 * расшифровку и стираются.
 */
export const UPLOAD_SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 5 * 60;
/** Длиннее трёх часов файл не разбираем: столько не длится интервью. */
export const MAX_UPLOAD_SECONDS = 3 * 60 * 60;

export interface AudioChunk {
  readonly index: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly samples: Float32Array;
}

/** Каналы в один: среднее по каналам. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (let i = 0; i < first.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}

export function splitChunks(
  samples: Float32Array,
  sampleRate = UPLOAD_SAMPLE_RATE,
  seconds = CHUNK_SECONDS,
): readonly AudioChunk[] {
  const size = sampleRate * seconds;
  const chunks: AudioChunk[] = [];
  for (let offset = 0, index = 0; offset < samples.length; offset += size, index += 1) {
    const part = samples.subarray(offset, Math.min(samples.length, offset + size));
    chunks.push({
      index,
      startMs: Math.round((offset / sampleRate) * 1000),
      durationMs: Math.round((part.length / sampleRate) * 1000),
      samples: part,
    });
  }
  return chunks;
}

/** PCM 16 бит, моно, заголовок RIFF/WAVE на 44 байта. */
export function encodeWav(samples: Float32Array, sampleRate = UPLOAD_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return buffer;
}
