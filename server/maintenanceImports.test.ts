import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// На проде нет node_modules, а playwright исключён из сборки: статический
// импорт роняет maintenance.mjs при старте даже с выключенным исполнителем (B309).
describe('maintenance entry imports', () => {
  it('loads playwright only on demand', () => {
    const source = readFileSync(new URL('./maintenance.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'playwright(?:-core)?'/mu);
  });
});
