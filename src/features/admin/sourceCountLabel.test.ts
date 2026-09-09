import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceCountLabel } from './sourceCountLabel';

/**
 * Число источников называется настоящее или не называется вовсе (B212).
 *
 * «18+» простояло в разметке с тех пор, когда источников было восемнадцать:
 * на проде 2026-09-08 экран обещал «из 18+ каналов» и рядом же честно считал
 * «159 из 195» (PRB-024). Это тот же запрет выдуманных чисел, что в PRB-016.
 */
describe('sourceCountLabel', () => {
  it('называет столько источников, сколько их пришло', () => {
    expect(sourceCountLabel(Array.from({ length: 195 }, () => ({ count: 0 })))).toBe('195');
  });

  it('незагруженный список числа не получает', () => {
    expect(sourceCountLabel(undefined)).toBeNull();
  });

  it('пустой список — это ноль источников, а не «неизвестно»', () => {
    expect(sourceCountLabel([])).toBe('0');
  });
});

describe('в админке не осталось выдуманных чисел', () => {
  /** Комментарии рассказывают историю дефекта — печатает их не экран, а файл. */
  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/\/\/[^\n]*/gu, ' ');
  }

  it('«18+» не печатается ни на одном экране админки', () => {
    const directory = 'src/features/admin';
    const offenders = readdirSync(directory)
      .filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
      .filter((name) => code(readFileSync(join(directory, name), 'utf8')).includes('18+'));
    expect(offenders).toEqual([]);
  });
});
