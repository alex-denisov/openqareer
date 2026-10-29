import { describe, expect, it } from 'vitest';
import {
  NORTHWIND,
  connectLinkedIn,
  createNetworkEnv,
  disconnectLinkedIn,
  importContacts,
  jane,
  john,
  origin,
  profile,
  registerMember,
  secondCircle,
  sendSearch,
  type NetworkEnv,
} from './networkTestEnv';

/** Member U1 with LinkedIn connected and contacts at Northwind; candidate B targets Northwind. */
async function sharedNetwork(env: NetworkEnv) {
  const member = await registerMember(env, 'member.u1', {
    fullName: 'Ulla Member',
    headline: 'Head of Platform',
    contact: { email: 'ulla@example.test', phone: '+10000000000' },
  });
  connectLinkedIn(env, member.candidateId, 'ulla-member');
  const candidate = await registerMember(env, 'candidate.b', { fullName: 'Boris Seeker' });
  connectLinkedIn(env, candidate.candidateId, 'boris-seeker');
  return { member, candidate };
}

describe('platform members as 1st circle to each other (B561, owner 30.10)', () => {
  it('shows the member with LinkedIn connected by name, with the LinkedIn link and the person there', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [{ ...jane, roleTitle: 'CTO' }]);

    const { circle, body } = await secondCircle(env.app, candidate.authorization);

    expect(circle.platformMembers).toEqual({
      count: 1,
      members: [
        { fullName: 'Ulla Member', linkedinUrl: profile('ulla-member'), personName: 'Jane Roe' },
      ],
    });
    expect(body).not.toContain('ulla@example.test');
    expect(body).not.toContain('+10000000000');
    expect(body).not.toContain(member.candidateId);
  });

  it('counts a member once however many people they know at the company', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane]);
    await sendSearch(env.app, member.authorization, NORTHWIND, [
      { ...john, roleTitle: 'Engineering Manager' },
    ]);

    const { circle } = await secondCircle(env.app, candidate.authorization);

    expect(circle.platformMembers.count).toBe(1);
    expect(circle.platformMembers.members).toHaveLength(1);
  });

  it('never lists the candidate as their own platform member', async () => {
    const env = await createNetworkEnv();
    const { member } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane]);

    const { circle } = await secondCircle(env.app, member.authorization);

    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
  });

  it('leaves out a member without LinkedIn connected', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.offline', { fullName: 'Olga Offline' });
    const candidate = await registerMember(env, 'candidate.offline');
    connectLinkedIn(env, candidate.candidateId, 'candidate-offline');
    await importContacts(env.app, member.authorization, [jane]);

    const { circle, body } = await secondCircle(env.app, candidate.authorization);

    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
    expect(body).not.toContain('Olga Offline');
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });

  it('removes the member edges when LinkedIn is disconnected', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane, john]);

    expect((await disconnectLinkedIn(env.app, member.authorization)).statusCode).toBe(200);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });

  it('removes the member edges when the member deletes the account', async () => {
    const env = await createNetworkEnv();
    const { member } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane, john]);

    const deleted = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: { authorization: member.authorization, origin },
    });

    expect(deleted.statusCode).toBe(204);
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });

  it('adds the contacts a member read before this change once the member opens the contacts', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.earlier', { fullName: 'Erik Earlier' });
    const candidate = await registerMember(env, 'candidate.earlier');
    connectLinkedIn(env, candidate.candidateId, 'candidate-earlier');
    await importContacts(env.app, member.authorization, [jane]);
    connectLinkedIn(env, member.candidateId, 'erik-earlier');
    expect(env.networkIndexRepo.personCount()).toBe(0);

    await env.app.inject({
      url: '/api/v1/candidate/connection-contacts?limit=1',
      headers: { authorization: member.authorization },
    });

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformMembers.count).toBe(1);
  });

  it('follows the company of the latest import and skips manual contacts', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane]);
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
    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
  });

  it('shows platform members only to a candidate who is a member too, with LinkedIn connected', async () => {
    const env = await createNetworkEnv();
    const { member } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane]);
    const outsider = await registerMember(env, 'candidate.outsider');

    const { circle, body } = await secondCircle(env.app, outsider.authorization);

    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
    expect(body).not.toContain('Ulla Member');
  });

  it('prefers the connected LinkedIn account over a self-declared profile address', async () => {
    const env = await createNetworkEnv();
    const member = await registerMember(env, 'member.claims', {
      fullName: 'Clara Claims',
      contact: { linkedinUrl: profile('someone-famous') },
    });
    connectLinkedIn(env, member.candidateId, 'clara-claims');
    const candidate = await registerMember(env, 'candidate.claims');
    connectLinkedIn(env, candidate.candidateId, 'candidate-claims');
    await importContacts(env.app, member.authorization, [jane]);

    const { circle } = await secondCircle(env.app, candidate.authorization);

    expect(circle.platformMembers.members[0].linkedinUrl).toBe(profile('clara-claims'));
  });

  it('drops the edges a deleted account left behind the next time anyone reads them', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await importContacts(env.app, member.authorization, [jane]);
    env.candidateStore.deleteCandidate(member.candidateId);

    const { circle } = await secondCircle(env.app, candidate.authorization);

    expect(circle.platformMembers).toEqual({ count: 0, members: [] });
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });
});
