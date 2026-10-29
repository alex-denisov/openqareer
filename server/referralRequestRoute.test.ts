import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
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
  type NetworkEnv,
} from './networkTestEnv';

const askReferral = (app: FastifyInstance, authorization: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/candidate/vacancies/cluster-nw/referral-requests',
    headers: { authorization, origin },
  });

const incoming = async (app: FastifyInstance, authorization: string) => {
  const response = await app.inject({
    url: '/api/v1/candidate/referral-requests/incoming',
    headers: { authorization },
  });
  expect(response.statusCode).toBe(200);
  return { body: response.body, items: response.json().data.items as IncomingItem[] };
};

const answer = (
  app: FastifyInstance,
  authorization: string,
  requestId: string,
  decision: 'accept' | 'decline',
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/candidate/referral-requests/${requestId}/answer`,
    headers: { authorization, origin },
    payload: { decision },
  });

interface IncomingItem {
  readonly id: string;
  readonly status: string;
  readonly companyName: string;
  readonly vacancyTitle: string;
  readonly requester: { fullName: string; headline: string | null; linkedinUrl: string | null };
  readonly contacts: ReadonlyArray<{ fullName: string; roleTitle: string }>;
}

/** Member U1 shares contacts at Northwind; candidate B targets a Northwind vacancy. */
async function sharedNetwork(env: NetworkEnv) {
  const member = await registerMember(env, 'member.u1', {
    fullName: 'Ulla Member',
    headline: 'Head of Platform',
    contact: { linkedinUrl: profile('ulla-member'), email: 'ulla@example.test' },
  });
  const candidate = await registerMember(env, 'candidate.b', {
    fullName: 'Boris Seeker',
    headline: 'Engineering Manager',
    contact: { linkedinUrl: profile('boris-seeker'), phone: '+10000000000' },
  });
  expect((await grantContactsConsent(env.app, member.authorization)).statusCode).toBe(200);
  await importContacts(env.app, member.authorization, [
    { ...jane, roleTitle: 'CTO' },
    { ...john, companyName: 'Contoso' },
  ]);
  return { member, candidate };
}

describe('«Попросить рекомендацию» (B561 slice 3)', () => {
  it('sends the request to the member without telling the candidate who it is', async () => {
    const env = await createNetworkEnv();
    const { candidate } = await sharedNetwork(env);
    expect((await secondCircle(env.app, candidate.authorization)).circle.platformReferral).toEqual({
      status: 'none',
      introducers: [],
    });

    const asked = await askReferral(env.app, candidate.authorization);

    expect(asked.statusCode).toBe(200);
    expect(asked.json().data).toEqual({ status: 'pending' });
    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformReferral).toEqual({ status: 'pending', introducers: [] });
    expect(body).not.toContain('Ulla');
    expect(body).not.toContain('Jane Roe');
  });

  it('shows the member who asks and for which company, with only their own contacts there', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await askReferral(env.app, candidate.authorization);

    const { items, body } = await incoming(env.app, member.authorization);

    expect(items).toEqual([
      expect.objectContaining({
        status: 'pending',
        companyName: 'Northwind Labs',
        vacancyTitle: 'Руководитель платформы',
        requester: { fullName: 'Boris Seeker', headline: 'Engineering Manager', linkedinUrl: null },
        contacts: [{ fullName: 'Jane Roe', roleTitle: 'CTO' }],
      }),
    ]);
    expect(body).not.toContain('John Doe');
    expect(body).not.toContain('+10000000000');
    expect((await incoming(env.app, candidate.authorization)).items).toEqual([]);
  });

  it('reveals the names to the candidate only after the member accepts', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await askReferral(env.app, candidate.authorization);
    const [request] = (await incoming(env.app, member.authorization)).items;

    expect((await answer(env.app, candidate.authorization, request!.id, 'accept')).statusCode).toBe(
      404,
    );
    const accepted = await answer(env.app, member.authorization, request!.id, 'accept');

    expect(accepted.statusCode).toBe(200);
    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformReferral).toEqual({
      status: 'accepted',
      introducers: [
        {
          fullName: 'Ulla Member',
          headline: 'Head of Platform',
          linkedinUrl: profile('ulla-member'),
          people: [{ fullName: 'Jane Roe' }],
        },
      ],
    });
    expect(body).not.toContain('ulla@example.test');
    expect(body).not.toContain('jane-roe');
    expect((await incoming(env.app, member.authorization)).items[0]!.requester.linkedinUrl).toBe(
      profile('boris-seeker'),
    );
  });

  it('tells the candidate only that the members answered when they decline', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await askReferral(env.app, candidate.authorization);
    const [request] = (await incoming(env.app, member.authorization)).items;

    await answer(env.app, member.authorization, request!.id, 'decline');

    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformReferral).toEqual({ status: 'answered', introducers: [] });
    expect(body).not.toContain('Ulla');
  });

  it('refuses a request when no member has a path into the company', async () => {
    const env = await createNetworkEnv();
    const candidate = await registerMember(env, 'candidate.alone');

    const asked = await askReferral(env.app, candidate.authorization);

    expect(asked.statusCode).toBe(409);
    expect(asked.json().error.code).toBe('no_platform_paths');
  });

  it('withdraws the requests and the revealed names when the member revokes the consent', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await askReferral(env.app, candidate.authorization);
    const [request] = (await incoming(env.app, member.authorization)).items;
    await answer(env.app, member.authorization, request!.id, 'accept');

    await revokeContactsConsent(env.app, member.authorization);

    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformReferral).toEqual({ status: 'none', introducers: [] });
    expect(body).not.toContain('Jane Roe');
    expect((await incoming(env.app, member.authorization)).items).toEqual([]);
  });

  it('leaves out a member who agreed only to the earlier consent text', async () => {
    const env = await createNetworkEnv();
    const { member, candidate } = await sharedNetwork(env);
    await revokeContactsConsent(env.app, member.authorization);
    await env.app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/linkedin_contacts',
      headers: { authorization: member.authorization, origin },
      payload: { versionId: 'linkedin_contacts-v1.0' },
    });

    expect((await askReferral(env.app, candidate.authorization)).statusCode).toBe(409);
  });
});
