import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Russian route stops delivering a response after ~20 460 bytes (INC-026,
// measured again for PRB-013 on 2026-08-29). Files under `public/` are served
// whole to whoever asks — a browser, a social crawler — with no way to slice
// or range them from our side, so each one must fit inside a single response.
const ROUTE_RESPONSE_BUDGET_BYTES = 20_000;

describe('public asset route budget', () => {
  it('keeps every directly served public file inside one route response', () => {
    const root = new URL('../public/', import.meta.url).pathname;
    const oversized = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ name: entry.name, bytes: statSync(join(root, entry.name)).size }))
      .filter((file) => file.bytes > ROUTE_RESPONSE_BUDGET_BYTES);

    expect(oversized).toEqual([]);
  });
});
