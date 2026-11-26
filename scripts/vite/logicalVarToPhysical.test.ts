import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import {
  B640_LOGICAL_VAR_SHORTHAND,
  logicalVarToPhysical,
  physicalDeclarations,
} from './logicalVarToPhysical.ts';

const B640_FILE = '/repo/src/features/b640/styles/base-04.css';
const OTHER_FILE = '/repo/src/features/journey/consultant-strip.css';

async function run(css: string, from = B640_FILE): Promise<string> {
  const result = await postcss([logicalVarToPhysical()]).process(css, { from });
  return result.css;
}

describe('physicalDeclarations', () => {
  it('splits one or two values of a logical box shorthand into left/right or top/bottom', () => {
    expect(physicalDeclarations('padding-inline', 'var(--s)')).toEqual([
      ['padding-left', 'var(--s)'],
      ['padding-right', 'var(--s)'],
    ]);
    expect(physicalDeclarations('margin-block', 'var(--a) calc(var(--b) * -1)')).toEqual([
      ['margin-top', 'var(--a)'],
      ['margin-bottom', 'calc(var(--b) * -1)'],
    ]);
    expect(physicalDeclarations('inset-inline', '0 var(--s)')).toEqual([
      ['left', '0'],
      ['right', 'var(--s)'],
    ]);
    expect(physicalDeclarations('scroll-padding-block', 'var(--s)')).toEqual([
      ['scroll-padding-top', 'var(--s)'],
      ['scroll-padding-bottom', 'var(--s)'],
    ]);
  });

  it('maps logical border shorthands to the physical sides', () => {
    expect(physicalDeclarations('border-block-end', '2px solid var(--c)')).toEqual([
      ['border-bottom', '2px solid var(--c)'],
    ]);
    expect(physicalDeclarations('border-inline', 'var(--w) solid var(--c)')).toEqual([
      ['border-left', 'var(--w) solid var(--c)'],
      ['border-right', 'var(--w) solid var(--c)'],
    ]);
    expect(physicalDeclarations('border-inline-width', 'var(--w) 0')).toEqual([
      ['border-left-width', 'var(--w)'],
      ['border-right-width', '0'],
    ]);
  });

  it('leaves values without var(), longhands and unknown shapes alone', () => {
    expect(physicalDeclarations('padding-inline', '12px')).toBeNull();
    expect(physicalDeclarations('padding-inline-start', 'var(--s)')).toBeNull();
    expect(physicalDeclarations('padding', 'var(--s)')).toBeNull();
    expect(physicalDeclarations('margin-inline', 'var(--a) var(--b) var(--c)')).toBeNull();
  });
});

describe('logicalVarToPhysical', () => {
  it('rewrites B640 rules and keeps !important', async () => {
    const css = await run(
      '.b640 .sec-tabs a { padding-inline: var(--s); color: red; border-block-end: 2px solid var(--c) !important; }',
    );
    expect(css).toContain('padding-left: var(--s); padding-right: var(--s)');
    expect(css).toContain('border-bottom: 2px solid var(--c) !important');
    expect(css).not.toMatch(B640_LOGICAL_VAR_SHORTHAND);
  });

  it('does not touch CSS outside src/features/b640', async () => {
    const source = '.strip { padding-inline: var(--s); }';
    expect(await run(source, OTHER_FILE)).toBe(source);
  });
});

/** Every B640 stylesheet in the repo comes out free of the shorthands WebKit drops. */
describe('B640 sources after the rewrite', () => {
  const root = path.resolve(__dirname, '../../src/features/b640');
  const files = (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return name.endsWith('.css') ? [full] : [];
    });
  })(root);

  it('finds the B640 stylesheets', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(root, file), file]))('%s', async (_name, file) => {
    const css = await run(readFileSync(file, 'utf8'), file);
    expect(css).not.toMatch(B640_LOGICAL_VAR_SHORTHAND);
  });
});
