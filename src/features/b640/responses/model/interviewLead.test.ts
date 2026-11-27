import { describe, expect, it } from 'vitest';
import { recordingLine } from './interviewLead';

const view = (recording: object | null, durationMs: number | null) =>
  ({
    recording,
    metrics: durationMs === null ? null : { durationMs },
  }) as never;

// Макет o01c: «Как прошло интервью с Арка Холдинг? Запись из приложения есть, 58 минут.»
describe('recordingLine: вторая фраза «Что дальше» после интервью', () => {
  it('запись .app расшифрована — источник и длина', () => {
    expect(recordingLine(view({ source: 'app', status: 'ready' }, 58 * 60_000))).toBe(
      'Запись из приложения есть, 58 минут.',
    );
  });

  it('загруженный файл — «из файла»', () => {
    expect(recordingLine(view({ source: 'upload', status: 'ready' }, 21 * 60_000))).toBe(
      'Запись из файла есть, 21 минута.',
    );
  });

  it('без записи, без длины или пока расшифровывается — фразы нет', () => {
    expect(recordingLine(null)).toBeNull();
    expect(recordingLine(view(null, null))).toBeNull();
    expect(recordingLine(view({ source: 'app', status: 'transcribing' }, null))).toBeNull();
  });
});
