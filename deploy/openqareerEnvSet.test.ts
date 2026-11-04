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

describe('openqareer-env-set: ключ Search Console (04.11)', () => {
  it('принимает base64 со знаками + / = и не печатает значение', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, 'OPENQAREER_AI_MODEL=gpt-5.6-luna\n');
    const value = `${'QUJD+/'.repeat(30)}==`;
    const first = run(`OPENQAREER_GSC_SERVICE_ACCOUNT_B64=${value}\n`, file);
    expect(first).toContain('OPENQAREER_GSC_SERVICE_ACCOUNT_B64 set');
    expect(first).not.toContain(value);
    expect(readFileSync(file, 'utf8')).toContain(`OPENQAREER_GSC_SERVICE_ACCOUNT_B64=${value}`);
  });
});

describe('openqareer-env-set: ворота кредита Vertex (04.11)', () => {
  it.each([
    ['OPENQAREER_VERTEX_CREDIT_USD', '250'],
    ['OPENQAREER_VERTEX_CREDIT_SINCE', '2026-11-04'],
    ['OPENQAREER_VERTEX_CREDIT_SINCE', '2026-11-04T12:30:00Z'],
    ['OPENQAREER_VERTEX_CREDIT_UNTIL', '2026-11-09'],
    ['OPENQAREER_VERTEX_DAY_USD', '80'],
    ['OPENQAREER_VERTEX_CATALOG_SUMMARY_DAY_USD', '5.5'],
  ])('ставит %s=%s', (key, value) => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, 'OPENQAREER_AI_MODEL=gpt-5.6-luna\n');
    expect(run(`${key}=${value}\n`, file)).toContain(`${key} set`);
    expect(readFileSync(file, 'utf8')).toContain(`${key}=${value}`);
  });

  it('прежний ключ дневного предела Gemini больше не разрешён', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, 'OPENQAREER_AI_MODEL=gpt-5.6-luna\n');
    expect(() => run('OPENQAREER_BULK_GEMINI_DAY_USD=1\n', file)).toThrow();
  });
});
