import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./connector_inspection.js', import.meta.url), 'utf8')
  .replaceAll('__OPENQAREER_PLATFORM__', JSON.stringify('linkedin'))
  .replaceAll('__OPENQAREER_HH_MARKER__', JSON.stringify('[data-qa="profile"]'));

function inspect(input: {
  pathname: string;
  body?: string;
  profileLink?: string;
  navigationProfile?: boolean;
}) {
  const profile = input.profileLink ? { href: input.profileLink } : null;
  const document = {
    readyState: 'complete',
    title: 'LinkedIn',
    body: { innerText: input.body ?? '' },
    querySelector(selector: string) {
      if (selector === 'a[href*="/in/"]') return profile;
      if (input.navigationProfile && selector.includes('data-view-name="navigation-profile"')) {
        return {};
      }
      return null;
    },
  };
  const location = {
    origin: 'https://www.linkedin.com',
    pathname: input.pathname,
    href: `https://www.linkedin.com${input.pathname}`,
  };
  return runInNewContext(source, { document, location, URL });
}

describe('connector inspection script', () => {
  it('recognizes a signed-in feed after LinkedIn changes its navigation selectors', () => {
    expect(inspect({ pathname: '/feed/' })).toMatchObject({
      ready: true,
      signedInApplicant: true,
      login: false,
      otp: false,
      captcha: false,
    });
  });

  it('keeps the profile slug as an optional provider marker', () => {
    expect(
      inspect({
        pathname: '/in/alexey-denisov/',
        profileLink: 'https://www.linkedin.com/in/alexey-denisov/',
        navigationProfile: true,
      }),
    ).toMatchObject({ signedInApplicant: true, accountMarker: 'alexey-denisov' });
  });
});
