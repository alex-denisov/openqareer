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

/**
 * Top-level rules only. Comments are stripped, at-rules are skipped whole (a
 * `@media` override is a deliberate second declaration, not a duplicate), and a
 * grouped selector list stays one rule.
 */
function topLevelRules(css: string): TopLevelRule[] {
  const rules: TopLevelRule[] = [];
  let index = 0;
  let selectorStart = 0;
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css[index] === '@') {
      let depth = 0;
      while (index < css.length) {
        if (css.startsWith('/*', index)) {
          const end = css.indexOf('*/', index + 2);
          index = end === -1 ? css.length : end + 2;
          continue;
        }
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') {
          depth -= 1;
          if (depth === 0) { index += 1; break; }
        } else if (css[index] === ';' && depth === 0) { index += 1; break; }
        index += 1;
      }
      selectorStart = index;
      continue;
    }
    if (css[index] === '{') {
      const selectorText = css
        .slice(selectorStart, index)
        .replace(/\/\*[\s\S]*?\*\//gu, '');
      let depth = 1;
      let cursor = index + 1;
      while (cursor < css.length && depth > 0) {
        if (css.startsWith('/*', cursor)) {
          const end = css.indexOf('*/', cursor + 2);
          cursor = end === -1 ? css.length : end + 2;
          continue;
        }
        if (css[cursor] === '{') depth += 1;
        else if (css[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      rules.push({
        selectors: selectorText
          .split(',')
          .map((selector) => selector.trim())
          .filter(Boolean),
      });
      index = cursor;
      selectorStart = cursor;
      continue;
    }
    index += 1;
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
