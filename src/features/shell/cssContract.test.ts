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
 * touched. The baselines below are the duplicates inherited from earlier work:
 * the test fails when a new one appears **and** when a listed one is fixed, so
 * the list can only shrink, never quietly rot.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const KNOWN_DUPLICATES: Readonly<Record<string, readonly string[]>> = {
  'features/admin/admin-console.css': [
    '.admin-btn {',
    '.admin-primary-link {',
    '.admin-scope-note {',
    '.admin-table {',
  ],
  'features/shell/career-shell.css': [
    '.career-account-current {',
    '.career-account-delete-form {',
    '.career-account-form p {',
    '.career-account-panel {',
    '.career-account-text-button {',
    '.career-action-package li span {',
    '.career-action-package {',
    '.career-coach-next-question {',
    '.career-context-form fieldset {',
    '.career-context-form {',
    '.career-evidence-kind {',
    '.career-expert-auth {',
    '.career-inline-note {',
    '.career-market-caveat {',
    '.career-market-vacancies small {',
    '.career-mobile-tariffs {',
    '.career-modal-network-status {',
    '.career-rail-admin {',
    '.career-resume-error {',
    '.career-resume-panes {',
    '.career-resume-remove {',
    '.career-shell textarea {',
    '.career-topbar {',
    '.career-track-board {',
  ],
};

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

const TOP_LEVEL_SELECTOR = /^\.[a-zA-Z][^,{]*\{$/u;

function duplicateSelectorsOf(cssPath: string): string[] {
  const counts = new Map<string, number>();
  for (const rawLine of fs.readFileSync(cssPath, 'utf8').split('\n')) {
    const line = rawLine.trimEnd();
    if (TOP_LEVEL_SELECTOR.test(line)) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
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
