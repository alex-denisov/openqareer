import { describe, expect, it } from 'vitest';
import {
  createCandidateDeclaredIdentifierReceipt,
  normalizeReputationSourceUrl,
  retrieveReputationSourceReceipt,
} from './reputationSourceReceipt';

describe('reputationSourceReceipt', () => {
  it('allows declared public source hosts and strips fragments', () => {
    expect(normalizeReputationSourceUrl('https://www.instagram.com/alexey_s_denisov/#posts')).toBe(
      'https://www.instagram.com/alexey_s_denisov/',
    );
    expect(() => normalizeReputationSourceUrl('http://example.com/profile')).toThrow(
      'reputation_source_requires_https',
    );
    expect(() => normalizeReputationSourceUrl('https://example.com/profile')).toThrow(
      'reputation_source_host_not_allowed',
    );
  });

  it('stores only retrieval metadata and a content hash', async () => {
    const receipt = await retrieveReputationSourceReceipt(
      { candidateId: 'candidate-test', platform: 'fixture', sourceUrl: 'https://t.me/example' },
      {
        now: () => '2026-09-19T00:00:00.000Z',
        fetch: async () =>
          new Response('public fixture', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      },
    );

    expect(receipt).toMatchObject({
      candidateId: 'candidate-test',
      sourceUrl: 'https://t.me/example',
      observedAt: '2026-09-19T00:00:00.000Z',
      status: 'retrieved',
      coverage: 'content_retrieved',
      identityBinding: 'candidate_declared_source',
      contentBytes: 14,
    });
    expect(receipt.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).not.toHaveProperty('body');
  });

  it('marks LinkedIn challenge-like responses as blocked without treating them as absence', async () => {
    const receipt = await retrieveReputationSourceReceipt(
      { candidateId: 'candidate-test', platform: 'linkedin', sourceUrl: 'https://www.linkedin.com/in/example/' },
      { fetch: async () => new Response('challenge', { status: 403 }) },
    );

    expect(receipt.status).toBe('blocked');
    expect(receipt.coverage).toBe('blocked');
    expect(receipt.httpStatus).toBe(403);
  });

  it('records declared identifiers as digests without retaining their values', () => {
    const receipt = createCandidateDeclaredIdentifierReceipt(
      {
        candidateId: 'candidate-test',
        identifierType: 'email',
        value: 'Alexey.Denisov@example.com',
      },
      { now: () => '2026-09-19T00:00:00.000Z' },
    );

    expect(receipt).toMatchObject({
      candidateId: 'candidate-test',
      identifierType: 'email',
      observedAt: '2026-09-19T00:00:00.000Z',
      identityBinding: 'candidate_declared_identifier',
      coverage: 'declaration_only',
    });
    expect(receipt.identifierSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain('alexey');
    expect(() =>
      createCandidateDeclaredIdentifierReceipt({
        candidateId: 'candidate-test',
        identifierType: 'phone',
        value: 'not-a-phone',
      }),
    ).toThrow('candidate_identifier_phone_invalid');
  });
});
