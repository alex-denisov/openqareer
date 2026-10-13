import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunWizard, type FirstRunWizardProps } from './FirstRunWizard';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedCss = '';

function getBundledCss(): string {
  if (cachedCss) return cachedCss;
  const projectRoot = path.resolve(__dirname, '../../../');
  const shellCssPath = path.join(projectRoot, 'src/features/shell/career-shell.css');
  const wizardCssPath = path.join(projectRoot, 'src/features/onboarding/firstRunWizard.css');

  const shellCss = fs.existsSync(shellCssPath) ? fs.readFileSync(shellCssPath, 'utf8') : '';
  const wizardCss = fs.existsSync(wizardCssPath) ? fs.readFileSync(wizardCssPath, 'utf8') : '';

  cachedCss = `${shellCss}\n${wizardCss}`;
  return cachedCss;
}

export function renderFirstRunHtml(props: FirstRunWizardProps = {}): string {
  const css = getBundledCss();
  const markup = renderToStaticMarkup(<FirstRunWizard {...props} />);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Вход и первый запуск · openqareer</title>
  <style>
    ${css}
    body {
      margin: 0;
      padding: 0;
      background: var(--career-surface-app, #f8fafc);
      font-family: var(--career-font-sans, system-ui, -apple-system, sans-serif);
    }
  </style>
</head>
<body>
  ${markup}
</body>
</html>`;
}
