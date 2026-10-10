import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerScreen, type CareerScreenProps } from './CareerScreen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedCss = '';

function getBundledCss(): string {
  if (cachedCss) return cachedCss;
  const projectRoot = path.resolve(__dirname, '../../../');
  const shellCssPath = path.join(projectRoot, 'src/features/shell/career-shell.css');
  const careerCssPath = path.join(projectRoot, 'src/features/career-map/careerScreen.css');

  const shellCss = fs.existsSync(shellCssPath) ? fs.readFileSync(shellCssPath, 'utf8') : '';
  const careerCss = fs.existsSync(careerCssPath) ? fs.readFileSync(careerCssPath, 'utf8') : '';

  cachedCss = `${shellCss}\n${careerCss}`;
  return cachedCss;
}

export function renderCareerHtml(props: CareerScreenProps = {}): string {
  const css = getBundledCss();
  const markup = renderToStaticMarkup(<CareerScreen {...props} />);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Карьера · openqareer</title>
  <style>
    ${css}
    body {
      margin: 0;
      padding: var(--career-space-4);
      background: var(--career-surface-app);
      font-family: var(--career-font-sans);
    }
  </style>
</head>
<body>
  ${markup}
</body>
</html>`;
}
