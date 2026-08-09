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

function makeFixture(source) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-split-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'assets'));
  writeFileSync(
    join(directory, 'index.html'),
    '<div id="root"></div><script type="module" crossorigin src="/assets/index-test.js"></script>',
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
    assert.ok(bootstrap.includes('const FETCH_CONCURRENCY=2'));
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
