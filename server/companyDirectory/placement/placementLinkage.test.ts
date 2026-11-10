import { describe, expect, it } from 'vitest';
import {
  buildLinkageIndex,
  classifyCoverage,
  linkByEmployerName,
  linkEmployerSource,
  type DirectoryRow,
} from './placementLinkage';

const rows: DirectoryRow[] = [
  { companyKey: 'stripe', companyName: 'Stripe, Inc.', websiteUrl: 'https://stripe.com', atsProvider: 'greenhouse', atsSlug: 'Stripe' },
  { companyKey: 'aleph-alpha', companyName: 'Aleph Alpha GmbH', websiteUrl: null, atsProvider: 'ashby', atsSlug: 'AlephAlpha' },
  { companyKey: 'tonies', companyName: 'tonies', websiteUrl: 'https://tonies.com', atsProvider: null, atsSlug: null },
  { companyKey: 'acme-us', companyName: 'Acme Corp', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'acme-de', companyName: 'ACME GmbH', websiteUrl: null, atsProvider: null, atsSlug: null },
];
const index = buildLinkageIndex(rows);

describe('linkEmployerSource', () => {
  it('ties an ATS board by provider and slug, case-insensitive', () => {
    expect(linkEmployerSource('ats-greenhouse-stripe', index)).toEqual({ companyKey: 'stripe', how: 'ats_board' });
    expect(linkEmployerSource('ats-ashby-AlephAlpha', index)).toEqual({ companyKey: 'aleph-alpha', how: 'ats_board' });
  });
  it('ties a company site and company LinkedIn source by company key', () => {
    expect(linkEmployerSource('src-company-site-tonies', index)).toEqual({ companyKey: 'tonies', how: 'company_key' });
    expect(linkEmployerSource('src-company-li-stripe', index)).toEqual({ companyKey: 'stripe', how: 'company_key' });
  });
  it('ties a freehire ATS board by provider and slug', () => {
    const withIcims = buildLinkageIndex([...rows, { companyKey: 'adl', companyName: 'Arthur D. Little', websiteUrl: null, atsProvider: 'icims', atsSlug: 'adlittle' }]);
    expect(linkEmployerSource('src-fh-icims-adlittle', withIcims)).toEqual({ companyKey: 'adl', how: 'ats_board' });
  });
  it('returns null for aggregators and unknown boards', () => {
    expect(linkEmployerSource('src-hh-search', index)).toBeNull();
    expect(linkEmployerSource('src-fh-getmatch', index)).toBeNull();
    expect(linkEmployerSource('ats-lever-nobody', index)).toBeNull();
  });
});

describe('linkByEmployerName', () => {
  it('links an exact nameKey match', () => {
    expect(linkByEmployerName('Stripe', index)).toEqual({ status: 'linked', companyKey: 'stripe' });
  });
  it('leaves a name shared by two companies ambiguous', () => {
    expect(linkByEmployerName('Acme', index)).toEqual({ status: 'ambiguous' });
  });
  it('reports unknown and empty names as unlinked', () => {
    expect(linkByEmployerName('Nobody Ltd', index)).toEqual({ status: 'unlinked' });
    expect(linkByEmployerName('', index)).toEqual({ status: 'unlinked' });
  });
});

describe('classifyCoverage', () => {
  it('picks the best placement in priority order site > ats > linkedin > aggregator', () => {
    expect(classifyCoverage(new Set(['aggregator', 'employer_site', 'ats']))).toBe('site');
    expect(classifyCoverage(new Set(['aggregator', 'ats']))).toBe('ats');
    expect(classifyCoverage(new Set(['linkedin', 'aggregator']))).toBe('linkedin');
    expect(classifyCoverage(new Set(['aggregator']))).toBe('aggregator_only');
    expect(classifyCoverage(new Set())).toBe('none');
  });
});
