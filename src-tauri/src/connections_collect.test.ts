// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractLinkedInConnections } from '../../src/features/connections/linkedinConnectionsExtract';

const source = readFileSync(join(__dirname, 'connections_collect.js'), 'utf8');
const fixture = readFileSync(
  join(__dirname, '../../src/features/connections/__fixtures__/linkedin/connections.html'),
  'utf8',
);
const run = (mode: 'reset' | 'collect' | 'emit'): unknown => (0, eval)(source)(mode);

describe('compact LinkedIn connections collector (B448)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
    run('reset');
  });

  it('agrees with the full-page parse on the real card structure', () => {
    expect(run('collect')).toBe(4);
    expect(extractLinkedInConnections(run('emit') as string)).toEqual(
      extractLinkedInConnections(fixture),
    );
  });

  it('keeps cards the list later empties while scrolling (virtualised rows)', () => {
    run('collect');
    for (const card of Array.from(
      document.querySelectorAll('[componentkey^="ConnectionCard_"] p'),
    )) {
      card.textContent = '';
    }
    run('collect');
    expect(extractLinkedInConnections(run('emit') as string)).toEqual(
      extractLinkedInConnections(fixture),
    );
  });

  it('escapes markup in names and headlines', () => {
    const name = document.querySelector('[componentkey^="ConnectionCard_"] a[href] + div a p');
    if (name) name.textContent = '<b>Ирина</b> & "Ко"';
    run('collect');
    expect(run('emit')).not.toContain('<b>');
  });

  it('emits nothing before any card was seen', () => {
    document.documentElement.innerHTML = '<main><p>No cards</p></main>';
    run('reset');
    expect(run('collect')).toBe(0);
    expect(run('emit')).toBe('');
  });
});
