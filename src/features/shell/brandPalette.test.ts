import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * B138 — the owner reported that the logo and the interface were two different
 * colours, and they were: the mark is blue (OKLCH hue 252–261) while the shell
 * accent sat at hue 184, a cyan ~70° away. Nothing in the build could notice,
 * because a hue is just a number inside a stylesheet.
 *
 * This gate reads the shipped stylesheets and allows exactly four hues: the
 * brand hue, and the three signals that name a state rather than an identity.
 * A new colour outside that set is a design decision and needs a ticket, not a
 * quiet commit.
 */

const BRAND_HUE = 255;
const STATE_HUES = [154, 79, 28] as const;
const ALLOWED = new Set<number>([BRAND_HUE, ...STATE_HUES]);

const STYLESHEETS = [
  'src/App.css',
  'src/features/shell/career-shell.css',
] as const;

function huesIn(css: string): Map<number, string[]> {
  const found = new Map<number, string[]>();
  for (const match of css.matchAll(/oklch\(([^)]*)\)/gu)) {
    const parts = match[1].trim().split(/\s+/u);
    if (parts.length < 3) continue;
    const hue = Number(parts[2]);
    if (!Number.isFinite(hue)) continue;
    found.set(hue, [...(found.get(hue) ?? []), match[0]]);
  }
  return found;
}

describe('brand and interface share one hue family', () => {
  for (const stylesheet of STYLESHEETS) {
    it(`${stylesheet} uses only the brand hue and the three state hues`, () => {
      const hues = huesIn(readFileSync(stylesheet, 'utf8'));

      expect(hues.size).toBeGreaterThan(0);
      const offenders = [...hues.entries()]
        .filter(([hue]) => !ALLOWED.has(hue))
        .map(([hue, samples]) => `${hue}° → ${samples[0]}`);
      expect(offenders, 'colours outside the brand and state hues').toEqual([]);
    });
  }

  it('keeps the brand hue within the hue range measured off the logo', () => {
    // #0488f4 → 252.4°, #0a70e0 → 256.5°, #0f43a2 → 261.4°.
    expect(BRAND_HUE).toBeGreaterThanOrEqual(252);
    expect(BRAND_HUE).toBeLessThanOrEqual(261);
  });

  it('does not let the lockup carry a private colour of its own', () => {
    const shell = readFileSync('src/features/shell/career-shell.css', 'utf8');
    const lockup = shell.slice(shell.indexOf('.career-shell .brand-lockup'));

    // The wordmark is lifted for legibility on dark, but to the shell accent —
    // a literal here is exactly how the two palettes drifted apart before.
    expect(lockup).toContain('--brand-core: var(--career-accent);');
  });
});
