import { describe, expect, it } from 'vitest';
import { vacancyRemoteLabel } from './vacancyRemoteLabel';

describe('vacancyRemoteLabel (03.11)', () => {
  it('names the stored scope in Russian', () => {
    expect(
      vacancyRemoteLabel({ canonicalLocation: 'Remote', isRemote: true, remoteScope: 'US' }),
    ).toBe('Удалённо, только США');
    expect(
      vacancyRemoteLabel({ canonicalLocation: 'Remote', isRemote: true, remoteScope: 'global' }),
    ).toBe('Удалённо из любой страны');
  });

  it('never mixes English «Remote» with the Russian mark', () => {
    expect(vacancyRemoteLabel({ canonicalLocation: 'Remote', isRemote: true })).toBe('Удалённо');
    expect(vacancyRemoteLabel({ canonicalLocation: 'Germany, Remote', isRemote: true })).toBe(
      'Удалённо, Germany',
    );
    expect(vacancyRemoteLabel({ canonicalLocation: 'USA (Remote)', isRemote: true })).toBe(
      'Удалённо, USA',
    );
    expect(vacancyRemoteLabel({ isRemote: true })).toBe('Удалённо');
  });
});
