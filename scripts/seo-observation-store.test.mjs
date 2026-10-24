import { mkdtempSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { storeSeoObservation } from './seo-observation-store.mjs';

it('records unknown separately from measured zero, with private files and Moscow dates', () => {
  const dir=mkdtempSync(join(tmpdir(),'oq-seo-ledger-'));
  try {
    const options={directory:join(dir,'snapshots'),journalPath:join(dir,'JOURNAL.md'),appendJournal:true};
    storeSeoObservation('google',{mode:'operational_check',status:'unavailable',observedAt:'2026-10-23T21:30:00Z'},options);
    const file=storeSeoObservation('google',{mode:'official_api',observedAt:'2026-10-23T21:31:00Z',searchAnalytics:{clicks:0,impressions:4,position:2.8}},options);
    const journal=readFileSync(options.journalPath,'utf8');
    expect(journal).toContain('2026-10-24');
    expect(journal).toContain('недоступно');
    expect(journal).toContain('клики 0; показы 4; позиция 2.8');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(options.journalPath).mode & 0o777).toBe(0o600);
    expect(()=>storeSeoObservation('google',{mode:'synthetic_fixture'},options)).toThrow('Synthetic');
    expect(existsSync(file)).toBe(true);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
