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
type Card = [path: string, html: string, lines: number];
/**
 * The shell evaluates the file exactly as it is, with no wrapping
 * (`connector_session.rs`). A wrapper around a trailing `;` once made every
 * call a syntax error, and the walk collected nothing (run 8).
 */
const batch = (): Card[] => JSON.parse((0, eval)(source) as string) as Card[];
/** What the shell builds from the batches it kept (connector_session.rs). */
const emit = (cards: readonly Card[]) => `<main>${cards.map((card) => card[1]).join('')}</main>`;

describe('LinkedIn connections batch collector (B448)', () => {
  it('returns its batch when evaluated as the shell evaluates it', () => {
    document.documentElement.innerHTML = fixture;
    // A string, like the sanitize pass: the shell parses it as JSON twice.
    const value = (0, eval)(source) as unknown;
    expect(typeof value).toBe('string');
    expect(JSON.parse(value as string)).toHaveLength(4);
  });

  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
  });

  it('agrees with the full-page parse on the real card structure', () => {
    const cards = batch();
    expect(cards).toHaveLength(4);
    expect(extractLinkedInConnections(emit(cards))).toEqual(extractLinkedInConnections(fixture));
  });

  it('reports a card that lost its text as absent, not empty', () => {
    for (const p of Array.from(document.querySelectorAll('[componentkey^="ConnectionCard_"] p'))) {
      p.textContent = '';
    }
    expect(batch()).toEqual([]);
  });

  it('keys each card by its profile path and counts its lines', () => {
    expect(batch()[0]?.slice(0, 1)).toEqual(['/in/irina-kotova-test/']);
    expect(batch()[0]?.[2]).toBe(2);
  });

  it('escapes markup in names and headlines', () => {
    const name = document.querySelector('[componentkey^="ConnectionCard_"] a[href] + div a p');
    if (name) name.textContent = '<b>Ирина</b> & "Ко"';
    expect(batch()[0]?.[1]).not.toContain('<b>');
  });
});
