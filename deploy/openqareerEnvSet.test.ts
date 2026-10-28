import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'openqareer-env-set');

function run(input: string, file: string): string {
  return execFileSync('bash', [SCRIPT], {
    input,
    env: {
      ...process.env,
      OPENQAREER_ENV_FILE: file,
      OPENQAREER_ENV_OWNER: `${process.getuid?.()}:${process.getgid?.()}`,
    },
    encoding: 'utf8',
  });
}

describe('openqareer-env-set: ключ Anthropic (28.10)', () => {
  it('ставит ключ, не печатает значение и повтором ничего не меняет', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, 'OPENQAREER_AI_MODEL=gpt-5.6-luna\n');
    const key = 'sk-ant-api03-Abc_def-123';
    const first = run(`OPENQAREER_ANTHROPIC_API_KEY=${key}\n`, file);
    expect(first).toContain('OPENQAREER_ANTHROPIC_API_KEY set');
    expect(first).not.toContain(key);
    expect(readFileSync(file, 'utf8')).toContain(`OPENQAREER_ANTHROPIC_API_KEY=${key}`);
    expect(run(`OPENQAREER_ANTHROPIC_API_KEY=${key}\n`, file)).toContain('unchanged');
  });
});
