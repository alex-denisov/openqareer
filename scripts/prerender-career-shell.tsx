import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminConsole } from '../src/features/admin/AdminConsole';
import { LandingPage } from '../src/features/site/LandingPage';

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
 * The public root `/` delivers the indexed landing page with semantic H1,
 * structured JSON-LD and instant first paint.
 * The administrator console `/admin` has its own prerendered first paint.
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
      bootstrapRoot(renderToStaticMarkup(<LandingPage onNavigate={() => {}} />)),
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
