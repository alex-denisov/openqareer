import { describe, expect, it } from 'vitest';
import { UploadStaging } from './uploadStaging';

/**
 * Файл в 86 КБ уходил на сервер и не получал ответа: маршрут владельца рвёт
 * ответ примерно на 20 460 байт и в эту сторону (INC-031). Поэтому файл
 * приезжает частями по 12 КБ и собирается на сервере.
 */
describe('UploadStaging', () => {
  it('собирает файл из частей в исходном порядке', () => {
    const staging = new UploadStaging({ maxBytes: 1_000, ttlMs: 60_000 });

    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 2, part: 'AAAA' }, 0);
    const done = staging.accept(
      'candidate-1',
      { uploadId: 'u1', index: 1, total: 2, part: 'BBBB' },
      10,
    );

    expect(done.complete).toBe(true);
    expect(staging.take('candidate-1', 'u1', 20)).toBe('AAAABBBB');
  });

  it('не отдаёт незаконченную загрузку', () => {
    const staging = new UploadStaging({ maxBytes: 1_000, ttlMs: 60_000 });
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 2, part: 'AAAA' }, 0);

    expect(staging.take('candidate-1', 'u1', 20)).toBeUndefined();
  });

  it('чужую загрузку не отдаёт даже по верному идентификатору', () => {
    const staging = new UploadStaging({ maxBytes: 1_000, ttlMs: 60_000 });
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 1, part: 'AAAA' }, 0);

    expect(staging.take('candidate-2', 'u1', 20)).toBeUndefined();
    expect(staging.take('candidate-1', 'u1', 20)).toBe('AAAA');
  });

  it('одна часть уезжает один раз: повтор не удваивает файл', () => {
    const staging = new UploadStaging({ maxBytes: 1_000, ttlMs: 60_000 });
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 2, part: 'AAAA' }, 0);
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 2, part: 'AAAA' }, 1);
    staging.accept('candidate-1', { uploadId: 'u1', index: 1, total: 2, part: 'BBBB' }, 2);

    expect(staging.take('candidate-1', 'u1', 20)).toBe('AAAABBBB');
  });

  it('отказывает, когда части в сумме больше разрешённого файла', () => {
    const staging = new UploadStaging({ maxBytes: 6, ttlMs: 60_000 });
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 2, part: 'AAAA' }, 0);

    expect(() =>
      staging.accept('candidate-1', { uploadId: 'u1', index: 1, total: 2, part: 'BBBB' }, 1),
    ).toThrow(/больше/u);
  });

  it('брошенная загрузка не живёт вечно', () => {
    const staging = new UploadStaging({ maxBytes: 1_000, ttlMs: 100 });
    staging.accept('candidate-1', { uploadId: 'u1', index: 0, total: 1, part: 'AAAA' }, 0);

    expect(staging.take('candidate-1', 'u1', 1_000)).toBeUndefined();
  });
});
