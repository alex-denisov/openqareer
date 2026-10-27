import { describe, expect, it } from 'vitest';
import { buildIdentity, employersFromText, linkEvidence } from './identity';

const at = '2026-10-27T00:00:00.000Z';

describe('identity graph', () => {
  it('reads current and past employers from a profile', () => {
    expect(employersFromText('HR Director at Optilab\nRecruiter at Rosseti Digital (2019-2023)\nHR в компании Ромашка, Москва')).toEqual([
      'Optilab', 'Rosseti Digital', 'Ромашка',
    ]);
  });

  it('links an account through a past employer, not only the current one', () => {
    const identity = buildIdentity({ fullName: 'Anna Smith', companyName: 'Optilab', seedTexts: ['Talent lead at Optilab\nRecruiter at Rosseti Digital'] });
    expect(linkEvidence(identity, 'Anna Smith. Подбор в Rosseti Digital').reasons).toEqual(['employer', 'profession']);
  });

  it('confirms through a contact already found elsewhere', () => {
    const identity = buildIdentity({
      fullName: 'Anna Smith', companyName: 'Acme',
      known: [{ kind: 'instagram', value: 'annahires', href: 'https://instagram.com/annahires', status: 'published', sourceUrl: null, observedAt: at }],
    });
    expect(linkEvidence(identity, 'Anna Smith — insta: annahires').score).toBeGreaterThanOrEqual(3);
  });

  it('gives a namesake nothing, and a short company name does not match inside words', () => {
    const identity = buildIdentity({ fullName: 'Anna Smith', companyName: 'IT' });
    expect(linkEvidence(identity, 'Anna Smith. Digital artist, New Jersey').score).toBe(0);
  });

  it('counts the profession in Russian', () => {
    const identity = buildIdentity({ fullName: 'Ольга Петрова', companyName: 'Сбер' });
    expect(linkEvidence(identity, 'Ольга Петрова, рекрутер').reasons).toEqual(['profession']);
  });
});
