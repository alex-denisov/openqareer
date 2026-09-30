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
  shareboxProfile?: string;
}) {
  const profile = input.profileLink ? { href: input.profileLink } : null;
  const profileContainer = input.navigationProfile
    ? {
        querySelector(selector: string) {
          return selector === 'a[href*="/in/"]' ? profile : null;
        },
      }
    : null;
  const document = {
    readyState: 'complete',
    title: 'LinkedIn',
    body: { innerText: input.body ?? '' },
    querySelector(selector: string) {
      if (input.shareboxProfile && selector.includes('#shareboxProfilePictureComponentRef')) {
        return {
          querySelector: (inner: string) =>
            inner === 'a[href*="/in/"]' ? { href: input.shareboxProfile } : null,
        };
      }
      if (input.navigationProfile && selector.includes('data-view-name="navigation-profile"')) {
        return profileContainer ?? {};
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

  it('gets the profile marker from the authenticated navigation profile link', () => {
    expect(
      inspect({
        pathname: '/in/alexey-denisov/',
        profileLink: 'https://www.linkedin.com/in/alexey-denisov/',
        navigationProfile: true,
      }),
    ).toMatchObject({ signedInApplicant: true, accountMarker: 'alexey-denisov' });
  });

  it('does not mistake a profile link in page content for the signed-in account', () => {
    expect(
      inspect({
        pathname: '/feed/',
        profileLink: 'https://www.linkedin.com/in/someone-in-a-post/',
      }),
    ).toMatchObject({ signedInApplicant: true, accountMarker: null });
  });

  it('takes the marker from the address on the account own profile page (B325)', () => {
    expect(
      inspect({ pathname: '/in/emmy-rupp-123/', body: 'Emmy Rupp\nEdit profile\nPrivate to you' }),
    ).toMatchObject({ signedInApplicant: true, accountMarker: 'emmy-rupp-123' });
  });

  it('does not take the marker from someone else\'s profile page', () => {
    expect(
      inspect({ pathname: '/in/someone-else/', body: 'Someone Else\nConnect\nMessage' }),
    ).toMatchObject({ accountMarker: null });
  });

  it('takes the marker from the "Start a post" avatar on the feed right after sign-in (B325)', () => {
    expect(
      inspect({ pathname: '/feed/', shareboxProfile: 'https://www.linkedin.com/in/emmy-rupp-a24857422/' }),
    ).toMatchObject({ signedInApplicant: true, accountMarker: 'emmy-rupp-a24857422' });
  });
});
