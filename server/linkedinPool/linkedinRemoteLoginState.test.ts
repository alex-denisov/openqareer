import { describe, expect, it } from 'vitest';
import { detectRemoteLoginState, stripUrlQuery } from './linkedinRemoteLoginState';

describe('detectRemoteLoginState', () => {
  it.each([
    ['https://www.linkedin.com/login', 'login'],
    ['https://www.linkedin.com/uas/login-submit', 'login'],
    ['https://www.linkedin.com/checkpoint/challenge/abc', 'checkpoint'],
    ['https://www.linkedin.com/challenge/xyz', 'checkpoint'],
    ['https://www.linkedin.com/feed/', 'signed_in'],
    ['https://www.linkedin.com/feed', 'signed_in'],
  ] as const)('%s -> %s', (url, expected) => {
    expect(detectRemoteLoginState(url)).toBe(expected);
  });

  it('keeps the previous state on an unknown path or a foreign host', () => {
    expect(detectRemoteLoginState('https://www.linkedin.com/jobs/', 'checkpoint')).toBe('checkpoint');
    expect(detectRemoteLoginState('https://evil.example/feed', 'login')).toBe('login');
    expect(detectRemoteLoginState('about:blank', 'login')).toBe('login');
  });

  it('does not treat a lookalike host as LinkedIn', () => {
    expect(detectRemoteLoginState('https://notlinkedin.com/feed')).toBe('login');
  });
});

describe('stripUrlQuery', () => {
  it('drops query and fragment', () => {
    expect(stripUrlQuery('https://www.linkedin.com/checkpoint/x?token=secret#a')).toBe(
      'https://www.linkedin.com/checkpoint/x',
    );
    expect(stripUrlQuery('garbage')).toBe('');
  });
});
