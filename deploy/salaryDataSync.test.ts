import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BODY = '{"rows":[]}\n';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const STUBS: Record<string, string> = {
  timeout: 'shift; exec "$@"',
  sudo: 'cat > "$BASE/asked"; echo "$*" > "$BASE/command"; [[ -f "$BASE/down" ]] && exit 1; cat "$BASE/object"',
  sha256sum:
    'exec python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],\'rb\').read()).hexdigest())" "$1"',
};

function setup(manifest: string | null = `version=1\nsha256=${sha(BODY)}\n`) {
  const base = mkdtempSync(join(tmpdir(), 'oq-salary-'));
  const bin = join(base, 'bin');
  const data = join(base, 'data');
  mkdirSync(bin);
  mkdirSync(data);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  if (manifest !== null) writeFileSync(join(base, 'manifest'), manifest);
  writeFileSync(join(base, 'object'), BODY);
  const target = join(data, 'salary-benchmarks.json');
  const run = () =>
    spawnSync(
      'bash',
      [join(import.meta.dirname, 'openqareer-salary-sync'), join(base, 'manifest')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          BASE: base,
          OPENQAREER_SALARY_FILE: target,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
      },
    );
  return { base, data, target, run };
}

describe('openqareer-salary-sync', () => {
  it('downloads by the hash of the manifest, then does nothing', () => {
    const { base, target, run } = setup();
    expect(run()).toMatchObject({ status: 0, stdout: 'updated' });
    expect(readFileSync(target, 'utf8')).toBe(BODY);
    expect(readFileSync(join(base, 'asked'), 'utf8')).toBe(`${sha(BODY)}\n`);
    expect(readFileSync(join(base, 'command'), 'utf8')).toBe(
      '-n /usr/local/sbin/openqareer-salary-fetch\n',
    );
    writeFileSync(join(base, 'down'), '');
    expect(run()).toMatchObject({ status: 0, stdout: 'kept' });
  });

  it.each([
    ['the download fails', 'down', ''],
    ['the object is not the one named', 'object', 'other'],
  ])('keeps the previous file when %s', (_name, file, content) => {
    const { base, data, target, run } = setup();
    writeFileSync(target, 'previous');
    writeFileSync(join(base, file), content);
    expect(run()).toMatchObject({ status: 0, stdout: 'failed' });
    expect(readFileSync(target, 'utf8')).toBe('previous');
    expect(readdirSync(data)).toEqual(['salary-benchmarks.json']);
  });

  it('a manifest without a hash or no manifest never asks for a download', () => {
    const broken = setup('sha256=../../etc\n');
    expect(broken.run()).toMatchObject({ status: 0, stdout: 'failed' });
    expect(setup(null).run()).toMatchObject({ status: 0, stdout: 'none' });
    expect(existsSync(join(broken.base, 'asked'))).toBe(false);
  });
});

it('the fetch helper takes only a hash', () => {
  const result = spawnSync('bash', [join(import.meta.dirname, 'openqareer-salary-fetch')], {
    input: '../users\n',
    encoding: 'utf8',
  });
  expect(result.status).toBe(2);
});
