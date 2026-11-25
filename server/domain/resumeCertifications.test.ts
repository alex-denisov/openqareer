import { describe, expect, it } from 'vitest';
import { shownCertifications } from './resumeCertifications';
import { relevanceOf } from './resumeRelevance';

const NOW = new Date('2026-11-25T12:00:00Z');
const item = (name: string, more: object = {}) => ({ id: name, name, ...more });
const shown = (all: ReturnType<typeof item>[], skills: string[] = []) =>
  shownCertifications(all, relevanceOf(null, skills), NOW).map(({ id }) => id);

describe('сертификаты в резюме под вакансию', () => {
  it('не больше четырёх: подходящие первыми, затем профессиональные и свежие', () => {
    const all = [
      item('Public Speaking', { issuedAt: '2025' }),
      item('PMI', { issuedAt: '2019-05' }),
      item('ITIL 4', { issuedAt: '2020' }),
      item('Kubernetes Basics', { issuedAt: '2015' }),
      item('Negotiation', { issuedAt: '2024' }),
    ];
    expect(shown(all, ['Kubernetes'])).toEqual([
      'Kubernetes Basics',
      'ITIL 4',
      'PMI',
      'Public Speaking',
    ]);
  });

  it('без подходящих — до двух самых весомых, без курсов', () => {
    const all = [
      item('Основы Python', { issuer: 'Stepik', issuedAt: '2026' }),
      item('Negotiation', { issuedAt: '2025' }),
      item('ITIL 4'),
      item('PMP'),
    ];
    expect(shown(all, ['Excel'])).toEqual(['ITIL 4', 'PMP']);
    expect(shown([all[0]!])).toEqual([]);
  });

  it.each([
    ['2026-10', 0],
    ['10.2026', 0],
    ['Oct 2026', 0],
    ['2025', 0],
    ['2026-11', 1],
    ['2026', 1],
    ['без срока', 1],
  ])('срок %s', (expiresAt, count) => {
    expect(shown([item('PMP', { expiresAt })])).toHaveLength(count);
  });

  it('из повторов остаётся свежий', () => {
    const old = item('ITIL-4', { issuedAt: '2018' });
    expect(shown([old, item('ITIL 4', { issuedAt: '2022' })])).toEqual(['ITIL 4']);
  });
});
