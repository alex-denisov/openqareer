import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerAccountView } from './CareerAccountView';
import type { AccountSectionId, MobileAccountViewId } from './accountTypes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedCss = '';

function getBundledCss(): string {
  if (cachedCss) return cachedCss;
  const projectRoot = path.resolve(__dirname, '../../../');
  const shellCssPath = path.join(
    projectRoot,
    'src/features/shell/career-shell.css',
  );
  const accountCssPath = path.join(
    projectRoot,
    'src/features/account/account.css',
  );

  const shellCss = fs.existsSync(shellCssPath)
    ? fs.readFileSync(shellCssPath, 'utf8')
    : '';
  const accountCss = fs.existsSync(accountCssPath)
    ? fs.readFileSync(accountCssPath, 'utf8')
    : '';

  cachedCss = `${shellCss}\n${accountCss}`;
  return cachedCss;
}

export interface RenderAccountOptions {
  readonly initialSection?: AccountSectionId;
  readonly initialMobileView?: MobileAccountViewId;
  readonly isPro?: boolean;
  readonly isMobile?: boolean;
}

export function renderAccountHtml(options: RenderAccountOptions = {}): string {
  const css = getBundledCss();
  const markup = renderToStaticMarkup(
    <CareerAccountView
      initialSection={options.initialSection}
      initialMobileView={options.initialMobileView}
      isPro={options.isPro}
      isMobile={options.isMobile}
    />,
  );

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Аккаунт · openqareer</title>
  <style>
    ${css}
    body {
      margin: 0;
      padding: 0;
      background-color: var(--career-color-bg, #090d16);
      color: var(--career-color-text, #f1f5f9);
      font-family: var(--career-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body>
  ${markup}
</body>
</html>`;
}
