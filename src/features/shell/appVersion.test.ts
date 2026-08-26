import { describe, expect, it } from 'vitest';
import { appVersionLine } from './appVersion';

describe('the version line the pilot reads out loud', () => {
  it('names the version and the exact build it came from', () => {
    expect(appVersionLine('1.0.0', '345be7211aa')).toBe(
      'openqareer 1.0.0 · сборка 345be72',
    );
  });

  it('says the build is unmarked instead of inventing one', () => {
    expect(appVersionLine('1.0.0', '')).toBe('openqareer 1.0.0 · сборка не помечена');
    expect(appVersionLine('1.0.0', '   ')).toBe(
      'openqareer 1.0.0 · сборка не помечена',
    );
  });
});
