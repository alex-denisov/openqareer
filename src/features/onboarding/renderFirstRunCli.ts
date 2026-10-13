import fs from 'node:fs';
import path from 'node:path';
import { renderFirstRunHtml } from './renderFirstRunHtml';

function writeBatch(outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });

  const variants = [
    { name: 'desktop-1440-intake.html', props: { initialStep: 'source' as const, isMobile: false } },
    { name: 'mobile-390-intake.html', props: { initialStep: 'source' as const, isMobile: true } },
    { name: 'desktop-1440-skeleton.html', props: { specialState: 'skeleton' as const, isMobile: false } },
    { name: 'mobile-390-skeleton.html', props: { specialState: 'skeleton' as const, isMobile: true } },
    { name: 'desktop-1440-loading.html', props: { specialState: 'stale-loading' as const, isMobile: false } },
    { name: 'desktop-1440-error.html', props: { specialState: 'error' as const, isMobile: false } },
    { name: 'desktop-1440-session.html', props: { specialState: 'session-expired' as const, isMobile: false } },
    { name: 'desktop-1440-empty.html', props: { specialState: 'empty-sources' as const, isMobile: false } },
    { name: 'desktop-1440-partial.html', props: { specialState: 'partial-source' as const, isMobile: false } },
    { name: 'mobile-390-context.html', props: { initialStep: 'context' as const, isMobile: true } },
  ];

  for (const v of variants) {
    const html = renderFirstRunHtml(v.props);
    fs.writeFileSync(path.join(outDir, v.name), html, 'utf8');
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--batch-dir');
  const targetDir = idx !== -1 && args[idx + 1] ? args[idx + 1] : '/tmp/oq-b475-html';
  writeBatch(targetDir);
}

main();
