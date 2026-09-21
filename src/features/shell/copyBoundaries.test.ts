import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * B236 — две границы текста, о которые владелец споткнулся 2026-09-20/21.
 *
 * 1. Эмодзи запрещены везде, где их увидит человек: они читаются как машинный
 *    текст, не озвучиваются диктором и не проходят контракт дизайна. Иконка —
 *    Phosphor, слово — словом.
 * 2. Площадок много и будет больше, поэтому ни одна строка не подаёт hh.ru или
 *    LinkedIn как единственный путь и не отсылает «в десктопное приложение»:
 *    название площадки — только подстановкой из данных или примером в скобках,
 *    приложение — «приложение для компьютера» или просто «приложение».
 *
 * Страж читает строки исходников, а не собранный интерфейс: одна оставленная
 * узкая фраза вернётся на экран следующим импортом копии.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED = ['src', 'shared'];

/** Пиктограммы и символы-эмодзи; галочки и крестики (✓ ✕ ✗) — типографика, не эмодзи. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{2712}\u{2714}\u{2716}\u{2718}-\u{27BF}\u{2B50}\u{2B55}]|\u{FE0F}/u;

/**
 * Узкие фразы: «десктопное приложение» в тексте для человека и площадка как
 * единственный путь («только LinkedIn», «подключите hh.ru в …»).
 */
const NARROW = [
  /десктопн/i,
  /в десктопе/i,
  /(?:LinkedIn|hh\.ru)[^'"`\n]{0,40}(?:десктопн|только в)/i,
  /(?:импорт|подключите|импортируйте)\s+(?:LinkedIn|hh\.ru)\s+(?:и|или|либо)\s+(?:LinkedIn|hh\.ru)/i,
  /Resume Studio/,
] as const;

/** Технические и служебные упоминания (комментарии, тесты, идентификаторы). */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|\{\/\*)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function offenders(pattern: RegExp, files: readonly string[]): string[] {
  return files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        if (COMMENT_LINE.test(line)) return [];
        // Строка с русским текстом — то, что увидит кандидат; чисто техническая
        // строка (URL, ключ, идентификатор) не в счёт.
        if (!/[А-Яа-яЁё]/.test(line)) return [];
        return pattern.test(line) ? [`${path.relative(ROOT, file)}:${index + 1}`] : [];
      }),
  );
}

describe('copy boundaries (B236)', () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  it('не показывает эмодзи ни в одной строке интерфейса', () => {
    expect(offenders(EMOJI, files)).toEqual([]);
  });

  it('не подаёт одну площадку или десктопное приложение как единственный путь', () => {
    const found = NARROW.flatMap((pattern) => offenders(pattern, files));
    expect([...new Set(found)].sort()).toEqual([]);
  });
});
