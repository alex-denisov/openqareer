import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBuiltCss, logicalVarShorthands } from './checkB640BuiltCss.ts';

describe('logicalVarShorthands', () => {
  it('finds logical shorthands with var() in .b640 rules, inside layers and media', () => {
    const css =
      '@layer b640.base{.b640 .sec-tabs a{padding-inline:var(--s);color:red}' +
      '@media (width<=767px){.b640 .row{border-block-end:1px solid var(--c)}}}' +
      '.b640:not(#\\#) .x{inset-inline:0 var(--s)}';
    expect(logicalVarShorthands(css, 'styles.css')).toEqual([
      'styles.css: .b640 .sec-tabs a { padding-inline: var(--s) }',
      'styles.css: .b640 .row { border-block-end: 1px solid var(--c) }',
      'styles.css: .b640:not(#\\#) .x { inset-inline: 0 var(--s) }',
    ]);
  });

  it('accepts physical sides, longhands, literals and rules outside .b640', () => {
    const css =
      '.b640 a{padding-left:var(--s);padding-right:var(--s);padding-inline-start:var(--s)}' +
      '.b640 b{padding-inline:12px;margin-block:0}' +
      '.b640-boot{inset-inline:var(--s)}.career-shell a{padding-inline:var(--s)}';
    expect(logicalVarShorthands(css, 'x.css')).toEqual([]);
  });
});

describe('checkBuiltCss', () => {
  it('reads every css file of the assets folder', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'b640-css-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'assets', 'ok.css'), '.b640 a{padding-left:var(--s)}');
    writeFileSync(path.join(dist, 'assets', 'bad.css'), '.b640 a{margin-inline:var(--s)}');
    writeFileSync(path.join(dist, 'assets', 'app.js'), '.b640 a{margin-inline:var(--s)}');
    expect(checkBuiltCss(dist)).toEqual(['bad.css: .b640 a { margin-inline: var(--s) }']);
  });
});
