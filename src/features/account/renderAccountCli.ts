import fs from 'node:fs';
import path from 'node:path';
import { renderAccountHtml } from './renderAccountHtml';
import type { AccountSectionId, MobileAccountViewId } from './accountTypes';

interface CliArgs {
  readonly out: string;
  readonly batchDir: string;
  readonly section: AccountSectionId;
  readonly mobileView: MobileAccountViewId;
  readonly isPro: boolean;
  readonly isMobile: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let out = '';
  let batchDir = '';
  let section: AccountSectionId = 'prof';
  let mobileView: MobileAccountViewId = 'home';
  let isPro = false;
  let isMobile = false;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') out = args[++i] ?? '';
    else if (args[i] === '--batch-dir') batchDir = args[++i] ?? '';
    else if (args[i] === '--section') section = (args[++i] ?? 'prof') as AccountSectionId;
    else if (args[i] === '--mobile-view') mobileView = (args[++i] ?? 'home') as MobileAccountViewId;
    else if (args[i] === '--pro') isPro = true;
    else if (args[i] === '--mobile') isMobile = true;
  }
  return { out, batchDir, section, mobileView, isPro, isMobile };
}

function runBatchRender(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const desktopViews: readonly { id: AccountSectionId; file: string; isPro?: boolean }[] = [
    { id: 'prof', file: 'desktop-prof.html' },
    { id: 'conn', file: 'desktop-conn.html' },
    { id: 'notif', file: 'desktop-notif.html' },
    { id: 'cons', file: 'desktop-cons.html' },
    { id: 'app', file: 'desktop-app.html' },
    { id: 'pay', file: 'desktop-pay-pro.html', isPro: true },
  ];
  for (const item of desktopViews) {
    const html = renderAccountHtml({ initialSection: item.id, isPro: item.isPro });
    fs.writeFileSync(path.join(dir, item.file), html, 'utf8');
  }

  const mobileViews: readonly { id: MobileAccountViewId; file: string }[] = [
    { id: 'home', file: 'mobile-home.html' },
    { id: 'dev', file: 'mobile-dev.html' },
    { id: 'conn', file: 'mobile-conn.html' },
    { id: 'notif', file: 'mobile-notif.html' },
    { id: 'cons', file: 'mobile-cons.html' },
  ];
  for (const item of mobileViews) {
    const html = renderAccountHtml({ isMobile: true, initialMobileView: item.id });
    fs.writeFileSync(path.join(dir, item.file), html, 'utf8');
  }
}

function runCli() {
  const args = parseArgs();
  if (args.batchDir) {
    runBatchRender(args.batchDir);
    return;
  }
  const html = renderAccountHtml({
    initialSection: args.section,
    initialMobileView: args.mobileView,
    isPro: args.isPro,
    isMobile: args.isMobile,
  });
  if (args.out) {
    fs.writeFileSync(args.out, html, 'utf8');
  } else {
    process.stdout.write(html);
  }
}

runCli();
