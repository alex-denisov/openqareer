import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 09.11: a lost `}` after a merge nested the whole GEO block in a rule and it never applied. */
describe('server page stylesheets', () => {
  for (const file of ['guides.css', 'salaryMarketPage.css', 'interviewQuestions.css']) {
    it(`${file} has balanced braces`, () => {
      const css = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(
        /\/\*[\s\S]*?\*\//gu,
        '',
      );
      let depth = 0;
      for (const char of css) {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    });
  }
});
