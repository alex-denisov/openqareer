import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Production serves `style-src 'self'`, so the browser drops every `style`
 * attribute React renders: the layout a developer sees is not the layout the
 * candidate gets. PRB-012 moved all 76 of them into stylesheets; this test
 * keeps them out.
 *
 * The second guard is the other half of the same defect. A class declared
 * twice at the top level silently overrides its own earlier rule — that is how
 * a duplicated `.career-modal-backdrop` restyled the import modal nobody had
 * touched.
 *
 * Reading the stylesheet line by line is what made the first version of this
 * guard wrong: the last line of a grouped selector (`.a,\n.b {`) looks exactly
 * like a rule of its own, so twenty group members were reported as duplicates.
 * Acting on that list dropped the group's declarations for the other members
 * and left `.career-wordmark` with the browser's default button chrome. The
 * scanner below tracks braces, comments and at-rules instead, and only counts a
 * selector that is declared **alone** more than once.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Nothing may be declared twice any more; this list must stay empty. */
const KNOWN_DUPLICATES: Readonly<Record<string, readonly string[]>> = {};

function findFiles(dir: string, filter: (filePath: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, filter));
    } else if (entry.isFile() && filter(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

interface TopLevelRule {
  readonly selectors: readonly string[];
}

/** Index just past the comment that starts at `from`. */
function skipComment(css: string, from: number): number {
  const end = css.indexOf('*/', from + 2);
  return end === -1 ? css.length : end + 2;
}

/** Index just past a whole at-rule: a `@media` override is not a duplicate. */
function skipAtRule(css: string, from: number): number {
  let index = from;
  let depth = 0;
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      index = skipComment(css, index);
      continue;
    }
    const char = css[index];
    index += 1;
    if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) break;
    else if (char === ';' && depth === 0) break;
  }
  return index;
}

/** Index just past the block whose `{` sits at `from`. */
function skipBlock(css: string, from: number): number {
  let index = from + 1;
  let depth = 1;
  while (index < css.length && depth > 0) {
    if (css.startsWith('/*', index)) {
      index = skipComment(css, index);
      continue;
    }
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') depth -= 1;
    index += 1;
  }
  return index;
}

function selectorsOf(selectorText: string): string[] {
  return selectorText
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean);
}

/**
 * Top-level rules only, with a grouped selector list kept as one rule. Reading
 * the file line by line is what made the first version of this guard wrong.
 */
function topLevelRules(css: string): TopLevelRule[] {
  const rules: TopLevelRule[] = [];
  let index = 0;
  let selectorStart = 0;
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      index = skipComment(css, index);
    } else if (css[index] === '@') {
      index = skipAtRule(css, index);
      selectorStart = index;
    } else if (css[index] === '{') {
      rules.push({ selectors: selectorsOf(css.slice(selectorStart, index)) });
      index = skipBlock(css, index);
      selectorStart = index;
    } else {
      index += 1;
    }
  }
  return rules;
}

function duplicateSelectorsOf(cssPath: string): string[] {
  const counts = new Map<string, number>();
  for (const rule of topLevelRules(fs.readFileSync(cssPath, 'utf8'))) {
    if (rule.selectors.length !== 1) continue;
    const selector = rule.selectors[0];
    counts.set(selector, (counts.get(selector) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([selector]) => selector)
    .sort();
}

describe('CSS contract', () => {
  it('has no inline styles in production tsx components', () => {
    const tsxFiles = findFiles(
      SRC_DIR,
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );

    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of tsxFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.includes('style={{')) {
          violations.push({
            file: path.relative(SRC_DIR, file),
            line: index + 1,
            text: line.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found inline styles blocked by CSP in production: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });

  it('declares no class twice at the top level of a stylesheet', () => {
    const cssFiles = findFiles(SRC_DIR, (file) => file.endsWith('.css')).sort();
    expect(cssFiles.length).toBeGreaterThan(0);

    const found: Record<string, readonly string[]> = {};
    for (const file of cssFiles) {
      const duplicates = duplicateSelectorsOf(file);
      if (duplicates.length > 0) {
        found[path.relative(SRC_DIR, file)] = duplicates;
      }
    }

    expect(found).toEqual(KNOWN_DUPLICATES);
  });
});

/**
 * B232. Кабинет копил кегли по одной фиче за раз: 59 разных `font-size` и 76
 * объявлений мельче 11 px в одном файле, 40–55 % текста на экране мельче
 * 12 px. Шкала из шести токенов — единственный источник размера текста; литерал
 * в `font-size` возвращает ту же россыпь через две фичи.
 */
describe('B232 typography scale', () => {
  const shellCss = fs.readFileSync(path.join(SRC_DIR, 'features/shell/career-shell.css'), 'utf8');
  const TEXT_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl', 'display'] as const;

  it('declares the six text tokens with a 13 px floor', () => {
    const declared = Object.fromEntries(
      TEXT_TOKENS.map((name) => [
        name,
        shellCss.match(new RegExp(`--career-text-${name}:\\s*([^;]+);`))?.[1]?.trim(),
      ]),
    );
    expect(declared).toEqual({
      xs: '0.8125rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.25rem',
      xl: '1.75rem',
      display: '2.5rem',
    });
  });

  it('declares the 4 px spacing scale', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (step) => shellCss.match(new RegExp(`--career-space-${step}:\\s*([^;]+);`))?.[1]?.trim(),
    );
    expect(steps).toEqual(['4px', '8px', '12px', '16px', '20px', '24px', '28px', '32px']);
  });

  it('sets every font-size in the shell from a text token', () => {
    // `--career-text-aux` (B248) is allowed strictly for auxiliary micro-labels
    // (mobile nav captions, the path indicator's reason lines) — never body
    // content. It is not a seventh step of the scale; see the token comment.
    const literals = [...shellCss.matchAll(/font-size:\s*([^;]+);/g)]
      .map((match) => match[1].trim())
      .filter(
        (value) => !/^var\(--career-text-(xs|sm|md|lg|xl|display|aux)\)( !important)?$/.test(value),
      );
    expect(literals).toEqual([]);
  });
});

/**
 * B248, owner review 2026-09-23 (390px) — the rail's left-edge active tick
 * (`.career-nav-button.is-active::before`) floated between two icons in the
 * five-item bottom nav, read as a stray blue bar with nothing to mark.
 */
describe('mobile bottom nav has no stray active tick', () => {
  const shellCss = fs.readFileSync(path.join(SRC_DIR, 'features/shell/career-shell.css'), 'utf8');

  it('cancels the rail active-tick pseudo-element inside .career-mobile-nav', () => {
    expect(shellCss).toMatch(
      /\.career-mobile-nav \.career-nav-button\.is-active::before\s*\{\s*content:\s*none;/u,
    );
  });
});
