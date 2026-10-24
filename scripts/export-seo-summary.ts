// Run with the installed tsx runtime; see SEO-SUMMARY.md.
import { constants, closeSync, fstatSync, openSync, readSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emptySeoPreparedSnapshot, seoPreparedSnapshotSchema } from '../shared/seoSourceSnapshot';
import { mergeSeoObservation } from './seo-prepared-projection';

function readJson(path: string, maxBytes: number): unknown {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('invalid_input_file');
    const bytes = Buffer.alloc(stat.size + 1);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length !== stat.size) throw new Error('input_changed');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { closeSync(descriptor); }
}

/** Local projection/export only. Does not collect credentials, call providers or publish remotely. */
export function exportSeoSummary(output: string, observations: Partial<Record<'google' | 'yandex', string>>, now = new Date()): void {
  let previous = emptySeoPreparedSnapshot(now.toISOString());
  try { previous = seoPreparedSnapshotSchema.parse(readJson(output, 128 * 1024)); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('invalid_existing_snapshot'); }
  for (const provider of ['google', 'yandex'] as const) {
    if (observations[provider]) previous = mergeSeoObservation(previous, provider, readJson(observations[provider]!, 1024 * 1024), now);
  }
  const json = JSON.stringify(previous) + '\n';
  if (Buffer.byteLength(json) > 128 * 1024) throw new Error('projection_too_large');
  const temporary = `${output}.${process.pid}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    created = true;
    renameSync(temporary, output);
    created = false;
  } finally { if (created) { try { unlinkSync(temporary); } catch { /* Only the owned temp file is cleaned. */ } } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
    const output = option('--output'); const google = option('--google'); const yandex = option('--yandex');
    if (!output || (!google && !yandex)) throw new Error('invalid_arguments');
    exportSeoSummary(resolve(output), { ...(google ? { google: resolve(google) } : {}), ...(yandex ? { yandex: resolve(yandex) } : {}) });
    process.stdout.write('Prepared SEO source projection exported.\n');
  } catch { process.stderr.write('SEO projection export failed; existing snapshot preserved.\n'); process.exitCode = 1; }
}
