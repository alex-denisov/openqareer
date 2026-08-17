import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminConsole } from '../src/features/admin/AdminConsole';
import { CareerWorkspaceShell } from '../src/features/shell/CareerWorkspaceShell';

const EMPTY_ROOT = '<div id="root"></div>';

function bootstrapRoot(markup: string): string {
  return (
    `<div id="root" aria-busy="true">` +
    `<div class="career-bootstrap-shell" data-bootstrap-shell="true" inert>` +
    markup +
    '</div></div>'
  );
}

/**
 * Two documents, one bundle.
 *
 * The client takes seconds to arrive over the production route (49 delivery
 * parts, one connection per response), and whatever the HTML already contains
 * is what the visitor stares at meanwhile. One shared document therefore meant
 * `/admin` showed the candidate workspace for five seconds before the console
 * replaced it — a measured 5356 ms on desktop, not a flash (B089).
 *
 * So each surface gets its own prerendered first paint, both built from the
 * same Vite output and both carrying the same entry script.
 */
export async function prerenderShells(
  indexPath: string,
  adminPath: string,
): Promise<void> {
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('id="root"')) {
    throw new Error('production root mount point is missing');
  }
  if (!html.includes(EMPTY_ROOT)) {
    throw new Error('production root mount point is not empty');
  }

  await writeFile(
    indexPath,
    html.replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<CareerWorkspaceShell />)),
    ),
  );
  // The console's own pending state, rendered by the console itself, so the
  // first paint and the mounted screen cannot drift apart.
  await writeFile(
    adminPath,
    html.replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<AdminConsole sessionPending />)),
    ),
  );
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  const indexPath = process.argv[2] ?? 'dist/index.html';
  const adminPath = process.argv[3] ?? 'dist/admin.html';
  await prerenderShells(indexPath, adminPath);
  process.stdout.write(
    `prerendered career shell into ${indexPath} and administrator console into ${adminPath}\n`,
  );
}
