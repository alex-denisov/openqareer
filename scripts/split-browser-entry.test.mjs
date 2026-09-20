import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { buildSplitDelivery } from './split-browser-entry.mjs';

const temporaryDirectories = [];

/** A minified stylesheet of `count` top-level rules, each a little different. */
function makeStylesheet(count) {
  return Array.from(
    { length: count },
    (unused, index) => `.rule-${index}{color:oklch(${index % 100}% .01 255);content:"}{"}`,
  ).join('');
}

function makeFixture(source, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-split-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'assets'));
  const stylesheetLink = options.stylesheet
    ? '<link rel="stylesheet" crossorigin href="/assets/index-test.css">'
    : '';
  if (options.stylesheet) {
    writeFileSync(join(directory, 'assets/index-test.css'), options.stylesheet);
  }
  writeFileSync(
    join(directory, 'index.html'),
    `${stylesheetLink}<div id="root"></div><script type="module" crossorigin src="/assets/index-test.js"></script>`,
  );
  writeFileSync(join(directory, 'assets/index-test.js'), source);
  writeFileSync(
    join(directory, 'assets/pdf-test.js'),
    `export const getDocument=1;export const GlobalWorkerOptions=2;${'y'.repeat(5_000)}`,
  );
  writeFileSync(
    join(directory, 'assets/pdfInspector.worker-test.js'),
    `self.addEventListener("message",()=>{});${'w'.repeat(5_000)}`,
  );
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('split browser entry delivery', () => {
  it('publishes bounded parts and a small integrity-checking bootstrap', () => {
    const source = `const release="release-test";${'x'.repeat(10_000)};import("./pdf-test.js");new Worker(new URL("./pdfInspector.worker-test.js",import.meta.url))`;
    const directory = makeFixture(source);
    const result = buildSplitDelivery({
      distDirectory: directory,
      release: 'release-test',
      partBytes: 4_096,
    });

    assert.equal(result.modules.length, 3);
    const entry = result.modules.find((module) => module.kind === 'app');
    assert.ok(entry.bootstrapBytes < 8_192);
    for (let index = 0; index < entry.partCount; index += 1) {
      const path = `${entry.proxyPath}.oqpart-${String(index).padStart(3, '0')}.js`;
      const part = readFileSync(join(directory, path));
      assert.ok(part.length <= 4_096);
      assert.equal(part.length, index < 2 ? 4_096 : source.length - 8_192);
    }

    const html = readFileSync(join(directory, 'index.html'), 'utf8');
    assert.ok(html.includes(result.entryProxyPath));
    assert.ok(!html.includes('src="/assets/index-test.js"'));
    assert.ok(html.includes('role="status"'));

    const bootstrap = readFileSync(join(directory, result.entryProxyPath), 'utf8');
    assert.ok(bootstrap.includes('release-test'));
    assert.ok(bootstrap.includes(entry.sourceHash));
    assert.ok(bootstrap.includes('["./pdf-test.js","/assets/pdf-test.js.split.js"]'));
    assert.ok(
      bootstrap.includes(
        '["./pdfInspector.worker-test.js","/assets/pdfInspector.worker-test.js.split.js"]',
      ),
    );
    assert.ok(bootstrap.includes('crypto.subtle.digest'));
    assert.ok(bootstrap.includes('AbortSignal.timeout(45000)'));
    assert.ok(bootstrap.includes('const FETCH_CONCURRENCY=6'));
    assert.ok(bootstrap.includes('await Promise.all(workers)'));
    assert.equal(
      bootstrap.includes(
        'for(let index=0;index<PART_COUNT;index+=1){loaded[index]=await fetchPart(index)',
      ),
      false,
    );
    assert.equal(existsSync(join(directory, 'assets/index-test.js')), false);
    assert.equal(existsSync(join(directory, 'assets/pdf-test.js')), false);
    assert.equal(
      existsSync(join(directory, 'assets/pdfInspector.worker-test.js')),
      false,
    );
    const worker = result.modules.find((module) => module.kind === 'worker');
    assert.ok(worker);
    const workerBootstrap = readFileSync(
      join(directory, worker.proxyPath),
      'utf8',
    );
    assert.ok(workerBootstrap.includes('pendingMessages'));
    assert.ok(workerBootstrap.includes('event.stopImmediatePropagation()'));
    assert.ok(workerBootstrap.includes('new MessageEvent("message",pending)'));
  });

  it('rewrites imports to small asset modules and updates non-split files referencing split modules', () => {
    const source = `const release="release-test";${'x'.repeat(10_000)};import("./pdfResume-test.js");import("./pdf-test.js")`;
    const directory = makeFixture(source);
    writeFileSync(
      join(directory, 'assets/pdfResume-test.js'),
      'import("./pdf-test.js");export const extractPdfResume = () => {};',
    );

    const result = buildSplitDelivery({
      distDirectory: directory,
      release: 'release-test',
      partBytes: 4_096,
    });

    const bootstrap = readFileSync(join(directory, result.entryProxyPath), 'utf8');
    assert.ok(
      bootstrap.includes('["./pdfResume-test.js","/assets/pdfResume-test.js"]'),
      'bootstrap must rewrite relative import of small module to absolute /assets/ path',
    );

    const smallModule = readFileSync(join(directory, 'assets/pdfResume-test.js'), 'utf8');
    assert.ok(
      smallModule.includes('/assets/pdf-test.js.split.js') || smallModule.includes('./pdf-test.js.split.js'),
      'small module on disk must have reference to split module rewritten to .split.js proxy',
    );
  });

  /**
   * B168 / INC-026 — the route drops any single response past ~20 KB, and the
   * render-blocking stylesheet was the one first-paint response nobody was
   * chunking. 137 KB of styles never arrived, the deferred module entry waited
   * on them, and `DOMContentLoaded` never fired: the site did not open at all.
   */
  it('chunks the render-blocking stylesheet into ordered bounded links', () => {
    const stylesheet = makeStylesheet(600);
    const directory = makeFixture(`const release=1;${'x'.repeat(10_000)}`, {
      stylesheet,
    });

    const result = buildSplitDelivery({
      distDirectory: directory,
      release: 'release-test',
      partBytes: 4_096,
    });

    assert.ok(result.stylesheets.length === 1);
    const sheet = result.stylesheets[0];
    assert.ok(sheet.partCount > 1, 'a 600-rule stylesheet needs several parts');

    // The original single oversized response must be gone, not merely unused.
    assert.equal(existsSync(join(directory, 'assets/index-test.css')), false);

    const html = readFileSync(join(directory, 'index.html'), 'utf8');
    const hrefs = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.equal(hrefs.length, sheet.partCount);

    // Order is the cascade. Concatenating the links in document order has to
    // reproduce the stylesheet byte for byte, or the styles are not the same.
    let rejoined = '';
    for (const [index, href] of hrefs.entries()) {
      assert.equal(href, `${sheet.sourcePath}.oqpart-${String(index).padStart(3, '0')}.css`);
      const part = readFileSync(join(directory, href));
      assert.ok(part.length <= 4_096, `part ${index} is ${part.length} bytes`);
      rejoined += part.toString('utf8');
    }
    assert.equal(rejoined, stylesheet);

    // Every part must be a stylesheet in its own right: a chunk cut through a
    // declaration would drop the rule it straddles in both halves.
    for (const href of hrefs) {
      const part = readFileSync(join(directory, href), 'utf8');
      let depth = 0;
      let quote = null;
      for (let index = 0; index < part.length; index += 1) {
        const character = part[index];
        if (quote) {
          if (character === quote) quote = null;
          continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
        assert.ok(depth >= 0, 'a part closes a block it never opened');
      }
      assert.equal(depth, 0, 'a part leaves a block open');
    }
  });

  /**
   * B168 — a part path that this release does not publish means the release
   * moved on under an open tab, not that the bundle is corrupt. The loader
   * used to compare byte lengths first and dead-end on "bad part length",
   * which is the message the owner was shown on `/admin`.
   */
  it('reads a missing or substituted part as a moved release, not a corrupt one', () => {
    const directory = makeFixture(`const release=1;${'x'.repeat(10_000)}`);
    const result = buildSplitDelivery({
      distDirectory: directory,
      release: 'release-test',
      partBytes: 4_096,
    });

    const entry = result.modules.find((module) => module.kind === 'app');
    const bootstrap = readFileSync(join(directory, entry.proxyPath), 'utf8');

    assert.ok(!bootstrap.includes('bad part length'), 'the opaque message is gone');
    assert.ok(bootstrap.includes('404'), 'a missing part is recognised');
    assert.ok(bootstrap.includes('content-type'), 'a substituted document is recognised');
    assert.ok(
      bootstrap.includes('Приложение обновилось'),
      'the reader is told the release moved, in their language',
    );
    // A worker runs the same loader and has neither sessionStorage nor
    // location.reload; reaching for them there would replace a recoverable
    // load with a thrown ReferenceError.
    assert.ok(bootstrap.includes('typeof location'), 'reload is feature-detected');
  });

  it('leaves a build without a stylesheet link untouched', () => {
    const directory = makeFixture(`const release=1;${'x'.repeat(10_000)}`);

    const result = buildSplitDelivery({
      distDirectory: directory,
      release: 'release-test',
      partBytes: 4_096,
    });

    assert.deepEqual(result.stylesheets, []);
  });

  it('rejects an index without a safe production entry', () => {
    const directory = makeFixture('export default 1');
    writeFileSync(
      join(directory, 'index.html'),
      '<script type="module" src="https://other.example/app.js"></script>',
    );
    assert.throws(
      () => buildSplitDelivery({ distDirectory: directory }),
      /no single safe module entry/,
    );
  });
});
