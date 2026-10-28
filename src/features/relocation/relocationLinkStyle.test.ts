import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Owner rule: links are never underlined. Source links on a country card were. */
const CSS = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'RelocationScreen.css'),
  'utf8',
);

function linkRules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, selector = '', body = '']) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => /(^|\s)a$/u.test(selector) && !selector.includes(','));
}

describe('relocation links', () => {
  it('every link rule removes the underline', () => {
    const rules = linkRules(CSS);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.body, rule.selector).toMatch(/text-decoration:\s*none/u);
  });
});
