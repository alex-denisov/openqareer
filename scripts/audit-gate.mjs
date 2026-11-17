// Full-tree dependency audit with dated, named exceptions.
//
// `npm audit --audit-level=high` has no way to skip one advisory, so a single
// advisory without a patched release stops every merge and deploy. This gate
// keeps the same bar (no high or critical advisory) and lets a listed advisory
// through until its date. Production dependencies are audited separately in CI
// with no exceptions at all.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Advisories allowed through until `until` (inclusive, UTC date). */
export const EXCEPTIONS = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    until: '2026-12-17',
    reason:
      'picomatch ReDoS: no patched release exists (latest 4.0.7 is affected); reached only through build and test tooling (vite, vitest, eslint), never through production dependencies.',
  },
];

const BLOCKING = new Set(['high', 'critical']);

function advisoryId(advisory) {
  const url = typeof advisory.url === 'string' ? advisory.url : '';
  return url.slice(url.lastIndexOf('/') + 1) || String(advisory.source ?? 'unknown');
}

/** Returns the high and critical advisories that no live exception covers. */
export function blockingAdvisories(report, exceptions, today) {
  const allowed = new Set(
    exceptions.filter((entry) => entry.until >= today).map((entry) => entry.id),
  );
  const found = new Map();
  for (const [packageName, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const advisory of entry.via ?? []) {
      if (typeof advisory !== 'object' || advisory === null) continue;
      if (!BLOCKING.has(advisory.severity)) continue;
      const id = advisoryId(advisory);
      if (allowed.has(id)) continue;
      found.set(id, { id, packageName, severity: advisory.severity, title: advisory.title });
    }
  }
  return [...found.values()];
}

function readAuditReport() {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is on stdout.
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{'))
      return error.stdout;
    throw error;
  }
}

function main() {
  const report = JSON.parse(readAuditReport());
  if (report.error) {
    console.error(`npm audit failed: ${JSON.stringify(report.error)}`);
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const blocking = blockingAdvisories(report, EXCEPTIONS, today);
  for (const entry of EXCEPTIONS) {
    const state = entry.until >= today ? `allowed until ${entry.until}` : `EXPIRED ${entry.until}`;
    console.log(`exception ${entry.id}: ${state} — ${entry.reason}`);
  }
  if (blocking.length === 0) {
    console.log('audit gate: no high or critical advisories outside the exceptions');
    return;
  }
  for (const item of blocking) {
    console.error(`${item.severity}: ${item.id} in ${item.packageName} — ${item.title}`);
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
