import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerWorkspaceShell } from '../src/features/shell/CareerWorkspaceShell';

const EMPTY_ROOT = '<div id="root"></div>';

export async function prerenderCareerShell(indexPath: string): Promise<void> {
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('id="root"')) {
    throw new Error('production root mount point is missing');
  }
  if (!html.includes(EMPTY_ROOT)) {
    throw new Error('production root mount point is not empty');
  }

  const shell = renderToStaticMarkup(<CareerWorkspaceShell />);
  const prerenderedRoot =
    `<div id="root" aria-busy="true">` +
    `<div class="career-bootstrap-shell" data-bootstrap-shell="true" inert>` +
    shell +
    '</div></div>';
  await writeFile(indexPath, html.replace(EMPTY_ROOT, prerenderedRoot));
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  const indexPath = process.argv[2] ?? 'dist/index.html';
  await prerenderCareerShell(indexPath);
  process.stdout.write(`prerendered career shell into ${indexPath}\n`);
}
