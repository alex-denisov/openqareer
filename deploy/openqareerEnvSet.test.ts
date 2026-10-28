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

describe('openqareer-env-set: очередь консультанта (28.10)', () => {
  const routes =
    'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free,openrouter:openrouter/free,gemini';

  it('ставит исключённые ступени консультанта и повтором ничего не меняет', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, 'OPENQAREER_AI_MODEL=gpt-5.6-luna\n');
    expect(run(`OPENQAREER_COACH_EXCLUDED_ROUTES=${routes}\n`, file)).toContain(
      'OPENQAREER_COACH_EXCLUDED_ROUTES set',
    );
    expect(readFileSync(file, 'utf8')).toContain(`OPENQAREER_COACH_EXCLUDED_ROUTES=${routes}`);
    expect(run(`OPENQAREER_COACH_EXCLUDED_ROUTES=${routes}\n`, file)).toContain(
      'OPENQAREER_COACH_EXCLUDED_ROUTES unchanged',
    );
  });

  it('не пропускает значение с пробелом или кавычкой', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oq-env-')), 'openqareer.env');
    writeFileSync(file, '');
    expect(() => run('OPENQAREER_COACH_EXCLUDED_ROUTES=gemini; rm -rf /\n', file)).toThrow();
  });
});
