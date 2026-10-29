import { describe, expect, it } from 'vitest';
import { candidateCompanyKey } from './domain/candidateCompanies';
import {
  NORTHWIND,
  createNetworkEnv,
  grantContactsConsent,
  importContacts,
  jane,
  john,
  origin,
  profile,
  registerMember,
  revokeContactsConsent,
  secondCircle,
  sendSearch,
} from './networkTestEnv';

describe('shared LinkedIn network index (B561 slice 2)', () => {
  it('keeps contacts out of the shared index without the consent', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.noconsent');
    const candidate = await registerMember(env, 'candidate.noconsent');

    expect((await importContacts(env.app, member.authorization, [jane])).statusCode).toBe(200);

    expect(env.networkIndexRepo.personCount()).toBe(0);
    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 0 });
  });

  it('shows another candidate only the count of paths through a consenting member', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.consent');
    const candidate = await registerMember(env, 'candidate.target');
    expect((await grantContactsConsent(env.app, member.authorization)).statusCode).toBe(200);

    await importContacts(env.app, member.authorization, [jane]);
    await sendSearch(env.app, member.authorization, NORTHWIND, [
      { ...john, roleTitle: 'Engineering Manager' },
    ]);

    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 2 });
    expect(body).not.toContain('Jane Roe');
    expect(body).not.toContain('John Doe');
    expect(body).not.toContain('jane-roe');
    expect(body).not.toContain('member.consent');
    expect(body).not.toContain(member.candidateId);
  });

  it('does not count the candidate own contacts as platform paths', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.self');
    expect((await grantContactsConsent(env.app, member.authorization)).statusCode).toBe(200);
    await importContacts(env.app, member.authorization, [jane]);

    const { circle } = await secondCircle(env.app, member.authorization);

    expect(circle.platformPaths).toEqual({ paths: 0 });
  });

  it('adds the contacts imported before the consent once it is given', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.later');
    const candidate = await registerMember(env, 'candidate.later');
    await importContacts(env.app, member.authorization, [jane, john]);

    expect((await grantContactsConsent(env.app, member.authorization)).statusCode).toBe(200);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 2 });
  });

  it('removes the member edges when the consent is revoked', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.revoke');
    const candidate = await registerMember(env, 'candidate.revoke');
    await grantContactsConsent(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);

    expect((await revokeContactsConsent(env.app, member.authorization)).statusCode).toBe(200);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 0 });
    expect(env.networkIndexRepo.personCount()).toBe(0);
    expect(
      env.networkIndexRepo.countPlatformPaths(candidateCompanyKey(NORTHWIND), '', () => true),
    ).toEqual({ paths: 0, members: 0 });
  });

  it('follows the company of the latest import and skips manual contacts', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.reimport');
    const candidate = await registerMember(env, 'candidate.reimport');
    await grantContactsConsent(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);
    await env.app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connection-contacts/manual-mary',
      headers: { authorization: member.authorization, origin },
      payload: {
        fullName: 'Mary Major',
        companyName: NORTHWIND,
        linkedinUrl: profile('mary-major'),
        relationship: 'Бывшая коллега',
      },
    });

    await importContacts(env.app, member.authorization, [{ ...jane, companyName: 'Contoso' }]);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 1 });
  });

  it('removes the member edges when the member deletes the account', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.leaves');
    await grantContactsConsent(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);

    const deleted = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: { authorization: member.authorization, origin },
    });

    expect(deleted.statusCode).toBe(204);
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });
});
