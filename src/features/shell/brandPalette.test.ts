import { readdirSync, readFileSync } from 'node:fs';
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

const STYLESHEETS = ['src/App.css', 'src/features/shell/career-shell.css'] as const;

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

/**
 * B649 — новый кабинет B640 живёт в своей палитре: оттенок интерфейса 200 и
 * мятный акцент, как в утверждённых макетах. Его файлы не входят в список выше:
 * прежний кабинет остаётся на оттенке 255, пока его не удалят. Здесь закреплены
 * оттенки нового каталога, чтобы цвет вне набора не появился тихо.
 */
const B640_TOKENS = 'src/features/b640/tokens.css';
const B640_BOOTSTRAP = 'src/features/b640/bootstrap.css';
const B640_INTERFACE_HUE = 200;
const B640_ACCENT_HUES = [170, 172, 175] as const;
const B640_STATE_HUES = [135, 80, 28] as const;
/** Тени без оттенка (0), лист резюме (140, 70) и тень подсказки, как на проде (255). */
const B640_RECORDED_HUES = [0, 140, 70, 255] as const;

describe('new cabinet B640 keeps its own pinned palette', () => {
  it('declares the interface hue once and derives surfaces from it', () => {
    const tokens = readFileSync(B640_TOKENS, 'utf8');
    expect(tokens.match(/--hue:\s*(\d+)/gu)).toEqual([`--hue: ${B640_INTERFACE_HUE}`]);
    expect(tokens).toContain('--career-bg: oklch(98.2% 0.004 var(--hue));');
    expect(tokens).toContain('--career-bg: oklch(15.5% 0.012 var(--hue));');
  });

  it('uses only the accent, state and recorded hues in tokens.css', () => {
    const allowed = new Set<number>([
      ...B640_ACCENT_HUES,
      ...B640_STATE_HUES,
      ...B640_RECORDED_HUES,
    ]);
    const hues = [...huesIn(readFileSync(B640_TOKENS, 'utf8')).keys()];
    expect(hues.filter((hue) => !allowed.has(hue))).toEqual([]);
    expect([...allowed].filter((hue) => !hues.includes(hue))).toEqual([]);
  });

  it('keeps light as the default theme, dark and system behind data-theme', () => {
    const tokens = readFileSync(B640_TOKENS, 'utf8');
    const light = tokens.lastIndexOf('color-scheme: light');
    expect(light).toBeGreaterThan(-1);
    expect(tokens.indexOf('.b640[data-theme="dark"]')).toBeGreaterThan(light);
    expect(tokens).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*\.b640\[data-theme="system"\]/u,
    );
  });

  it('takes every other colour from tokens: ported styles carry no hue of their own', () => {
    const files = readdirSync('src/features/b640/styles').filter((name) => name.endsWith('.css'));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const hues = [...huesIn(readFileSync(`src/features/b640/styles/${file}`, 'utf8')).keys()];
      expect(hues.filter((hue) => hue !== 0), file).toEqual([]);
    }
    expect([...huesIn(readFileSync(B640_BOOTSTRAP, 'utf8')).keys()]).toEqual([B640_INTERFACE_HUE]);
  });
});
