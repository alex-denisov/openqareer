import { describe, expect, it } from 'vitest';
import {
  parseEnvironmentFile,
  resolveHhTestAccountEnvironment,
} from './hhTestAccountEnvironment';

describe('hh.ru test-account environment resolution', () => {
  it('reads quoted, commented and padded env-file lines', () => {
    const parsed = parseEnvironmentFile(
      [
        '# comment',
        '',
        'OPENQAREER_HH_TEST_USERNAME="candidate@example.test"',
        "OPENQAREER_HH_TEST_PASSWORD='pw-with=equals'",
        '  OPENQAREER_OTHER = plain  ',
        'not a key line',
        'lowercase=ignored',
        '=missing-key',
      ].join('\n'),
    );

    expect(parsed).toEqual({
      OPENQAREER_HH_TEST_USERNAME: 'candidate@example.test',
      OPENQAREER_HH_TEST_PASSWORD: 'pw-with=equals',
      OPENQAREER_OTHER: 'plain',
    });
  });

  it('prefers the process environment over the env file', () => {
    const resolved = resolveHhTestAccountEnvironment(
      {
        OPENQAREER_HH_TEST_USERNAME: 'from-process@example.test',
        OPENQAREER_HH_TEST_PASSWORD: '',
      },
      [
        'OPENQAREER_HH_TEST_USERNAME=from-file@example.test',
        'OPENQAREER_HH_TEST_PASSWORD=from-file-password',
      ].join('\n'),
    );

    expect(resolved).toEqual({
      OPENQAREER_HH_TEST_USERNAME: 'from-process@example.test',
      OPENQAREER_HH_TEST_PASSWORD: 'from-file-password',
    });
  });

  it('reports undefined rather than empty strings when nothing is configured', () => {
    expect(resolveHhTestAccountEnvironment({}, null)).toEqual({
      OPENQAREER_HH_TEST_USERNAME: undefined,
      OPENQAREER_HH_TEST_PASSWORD: undefined,
    });
    expect(resolveHhTestAccountEnvironment({}, '# only a comment')).toEqual({
      OPENQAREER_HH_TEST_USERNAME: undefined,
      OPENQAREER_HH_TEST_PASSWORD: undefined,
    });
  });
});
