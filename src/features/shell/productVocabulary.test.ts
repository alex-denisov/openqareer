import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Слово «досье» ушло из продукта: «мы не в армии» (решение владельца
 * 2026-09-02, B182). Кандидат читает о своих же фактах человеческим языком.
 *
 * Страж запрещает слово целиком — и в тексте на экране, и в комментариях: одна
 * оставленная строка возвращает термин в продукт через следующую правку.
 *
 * Одно исключение (B484, макет 5): заголовок раздела о компании-работодателе в
 * панели выбранного отклика. Это сведения о компании, не факты кандидата;
 * исключение — ровно эта строка заголовка в этом файле, больше нигде.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED = ['src', 'server', 'shared'];
const FORBIDDEN = /досье/i;
const ALLOWED_COMPANY_SECTION = {
  file: 'src/features/applications/SelectedResponsePanel.tsx',
  line: /^\s*Досье\s*$/u,
};

function isAllowed(file: string, line: string): boolean {
  return file === ALLOWED_COMPANY_SECTION.file && ALLOWED_COMPANY_SECTION.line.test(line);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

describe('product vocabulary', () => {
  it('нигде не называет факты кандидата «досье»', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) => !file.endsWith('productVocabulary.test.ts'))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            FORBIDDEN.test(line) && !isAllowed(path.relative(ROOT, file), line)
              ? [`${path.relative(ROOT, file)}:${index + 1}`]
              : [],
          ),
      );

    expect(offenders).toEqual([]);
  });
});
