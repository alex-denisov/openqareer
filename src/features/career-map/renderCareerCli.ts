import fs from 'node:fs';
import path from 'node:path';
import { renderCareerHtml } from './renderCareerHtml';
import { DEFAULT_MOCK_ROLES, DEFAULT_SEARCH_CONDITIONS } from './careerMockData';

interface CliArgs {
  readonly out: string;
  readonly batchDir: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let out = '';
  let batchDir = '';

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') out = args[++i] ?? '';
    else if (args[i] === '--batch-dir') batchDir = args[++i] ?? '';
  }
  return { out, batchDir };
}

function runBatchRender(dir: string) {
  fs.mkdirSync(dir, { recursive: true });

  const baseProps = {
    initialRoles: DEFAULT_MOCK_ROLES,
    initialConditions: DEFAULT_SEARCH_CONDITIONS,
  };

  const states: readonly { file: string; props: Record<string, unknown> }[] = [
    { file: 'desktop-1440.html', props: { ...baseProps } },
    { file: 'desktop-1440-empty.html', props: { initialRoles: [], hasProfile: false } },
    { file: 'desktop-1440-error.html', props: { ...baseProps, marketError: 'Каталог не ответил' } },
    { file: 'desktop-1440-stale.html', props: { ...baseProps, isMarketStale: true } },
    { file: 'desktop-1440-loading.html', props: { ...baseProps, isLoading: true } },
    { file: 'mobile-390.html', props: { ...baseProps, isMobile: true, initialPushView: 'home' } },
    {
      file: 'mobile-390-dir.html',
      props: { ...baseProps, isMobile: true, initialPushView: 'dir' },
    },
    {
      file: 'mobile-390-sal.html',
      props: { ...baseProps, isMobile: true, initialPushView: 'sal' },
    },
  ];

  for (const state of states) {
    const html = renderCareerHtml(state.props);
    fs.writeFileSync(path.join(dir, state.file), html, 'utf8');
  }
}

function main() {
  const { out, batchDir } = parseArgs();
  if (batchDir) {
    runBatchRender(batchDir);
    return;
  }
  const html = renderCareerHtml({
    initialRoles: DEFAULT_MOCK_ROLES,
    initialConditions: DEFAULT_SEARCH_CONDITIONS,
  });
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, 'utf8');
  } else {
    process.stdout.write(html);
  }
}

main();
