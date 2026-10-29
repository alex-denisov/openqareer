import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteReferralRequestRepository } from './sqliteReferralRequestRepository';

const company = { companyKey: 'key-northwind', companyName: 'Northwind Labs', vacancyTitle: 'CTO' };
const at = '2026-10-30T10:00:00.000Z';

function createRepository() {
  return new SqliteReferralRequestRepository(new DatabaseSync(':memory:'));
}

describe('SqliteReferralRequestRepository (B561 slice 3)', () => {
  it('sends one request per member and company, and never twice', () => {
    const repository = createRepository();

    expect(repository.request('cand-b', ['member-a', 'member-c'], company, at)).toBe(2);
    expect(repository.request('cand-b', ['member-a'], company, at)).toBe(0);

    expect(repository.listIncoming('member-a').map((item) => item.status)).toEqual(['pending']);
    expect(repository.outgoingFor('cand-b', company.companyKey).map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
  });

  it('lets only the asked member answer, once', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    const [incoming] = repository.listIncoming('member-a');

    expect(repository.answer(incoming!.id, 'member-c', 'accepted', at)).toBe(false);
    expect(repository.answer(incoming!.id, 'member-a', 'accepted', at)).toBe(true);
    expect(repository.answer(incoming!.id, 'member-a', 'declined', at)).toBe(false);

    expect(repository.outgoingFor('cand-b', company.companyKey)[0]).toMatchObject({
      memberId: 'member-a',
      status: 'accepted',
    });
  });

  it('withdraws every request to a member who revokes the consent', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    const [incoming] = repository.listIncoming('member-a');
    repository.answer(incoming!.id, 'member-a', 'accepted', at);

    expect(repository.withdrawForMember('member-a', at)).toBe(1);

    expect(repository.outgoingFor('cand-b', company.companyKey)[0]!.status).toBe('withdrawn');
    expect(repository.listIncoming('member-a')).toEqual([]);
  });

  it('forgets a deleted candidate on both sides', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    repository.request('member-a', ['cand-b'], company, at);

    expect(repository.deleteForCandidate('cand-b')).toBe(2);

    expect(repository.listIncoming('member-a')).toEqual([]);
    expect(repository.outgoingFor('member-a', company.companyKey)).toEqual([]);
  });

  it('sends a withdrawn request again once asked again', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    repository.withdrawForMember('member-a', at);

    expect(repository.request('cand-b', ['member-a'], company, at)).toBe(1);
    expect(repository.listIncoming('member-a').map((item) => item.status)).toEqual(['pending']);
  });

  it('asks at most ten members at once', () => {
    const repository = createRepository();
    const members = Array.from({ length: 25 }, (_, index) => `member-${index}`);

    expect(repository.request('cand-b', members, company, at)).toBe(10);
  });

  it('stops a candidate at 30 open requests and a member at 20 pending ones', () => {
    const repository = createRepository();
    for (let index = 0; index < 4; index += 1) {
      const members = Array.from({ length: 10 }, (_, member) => `m-${index}-${member}`);
      repository.request('cand-b', members, { ...company, companyKey: `key-${index}` }, at);
    }
    expect(repository.openRequestCount('cand-b')).toBe(30);

    for (let index = 0; index < 25; index += 1) {
      repository.request(`asker-${index}`, ['busy-member'], company, at);
    }
    expect(repository.listIncoming('busy-member')).toHaveLength(20);
  });

  it('after a decline the same candidate cannot ask that member again, for any company', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    const [incoming] = repository.listIncoming('member-a');
    repository.answer(incoming!.id, 'member-a', 'declined', at);

    expect(
      repository.request('cand-b', ['member-a'], { ...company, companyKey: 'key-contoso' }, at),
    ).toBe(0);
    expect(repository.request('cand-other', ['member-a'], company, at)).toBe(1);
  });

  it('a decline also closes the asker other pending requests to that member', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, at);
    repository.request('cand-b', ['member-a'], { ...company, companyKey: 'key-contoso' }, at);
    const [first] = repository.listIncoming('member-a');

    repository.answer(first!.id, 'member-a', 'declined', at);

    expect(repository.listIncoming('member-a')).toEqual([]);
  });

  it('forgets answered and withdrawn requests after 90 days', () => {
    const repository = createRepository();
    repository.request('cand-b', ['member-a'], company, '2026-06-01T10:00:00.000Z');
    repository.withdrawForMember('member-a', '2026-06-01T10:00:00.000Z');

    repository.purgeExpired('2026-10-30T10:00:00.000Z');

    expect(repository.outgoingFor('cand-b', company.companyKey)).toEqual([]);
  });
});
