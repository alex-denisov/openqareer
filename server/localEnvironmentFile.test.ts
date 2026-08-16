import { describe, expect, it } from 'vitest';
import { resolveLocalEnvironmentFilePath } from './localEnvironmentFile';

describe('local environment file', () => {
  it('resolves the canonical owner-only path outside the repository', () => {
    const path = resolveLocalEnvironmentFilePath({
      HOME: '/Users/example',
    } as NodeJS.ProcessEnv);
    expect(path).toBe('/Users/example/.openqareer/openqareer.env');
  });

  it('never resolves a secret file inside the working tree', () => {
    const path = resolveLocalEnvironmentFilePath({
      HOME: '/Users/example',
    } as NodeJS.ProcessEnv);
    expect(path.startsWith(`${process.cwd()}/`)).toBe(false);
  });

  it('accepts an explicit override so CI and systemd can supply another file', () => {
    const path = resolveLocalEnvironmentFilePath({
      HOME: '/Users/example',
      OPENQAREER_LOCAL_ENV_PATH: '/etc/openqareer/openqareer.env',
    } as NodeJS.ProcessEnv);
    expect(path).toBe('/etc/openqareer/openqareer.env');
  });

  it('rejects a relative override instead of guessing a base directory', () => {
    expect(() =>
      resolveLocalEnvironmentFilePath({
        HOME: '/Users/example',
        OPENQAREER_LOCAL_ENV_PATH: 'openqareer.env',
      } as NodeJS.ProcessEnv),
    ).toThrow(/absolute/u);
  });

  it('fails closed when no home directory is known', () => {
    expect(() => resolveLocalEnvironmentFilePath({} as NodeJS.ProcessEnv)).toThrow(
      /home directory/u,
    );
  });
});
