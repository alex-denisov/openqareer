import { describe, expect, it } from 'vitest';
import { buildLinkageIndex } from './placementLinkage';
import { linkAggregatorRow, type AggregatorRow } from './aggregatorLinkage';

const index = buildLinkageIndex([
  { companyKey: 'acme', companyName: 'Acme Robotics', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'yandex', companyName: 'Яндекс', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'nova-1', companyName: 'Nova', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'nova-2', companyName: 'Nova', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'leon', companyName: 'Леон', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'alchemy', companyName: 'Alchemy', websiteUrl: null, atsProvider: null, atsSlug: null },
  { companyKey: 'confidential', companyName: 'Confidential', websiteUrl: null, atsProvider: null, atsSlug: null },
]);

const NAMES: Record<string, string> = { acme: 'Acme Robotics', yandex: 'Яндекс', leon: 'Леон', alchemy: 'Alchemy' };
const link = (row: AggregatorRow) => linkAggregatorRow(row, index, (key) => NAMES[key]);

describe('B643-8 aggregator row → company', () => {
  it('links an aggregator or hh row by exact name', () => {
    expect(link({ sourceId: 'src-remotive', company: 'Acme Robotics Inc.' })).toEqual({ status: 'linked', companyKey: 'acme', how: 'exact_name' });
    expect(link({ sourceId: 'hh', company: 'Яндекс' })).toEqual({ status: 'linked', companyKey: 'yandex', how: 'exact_name_single_word' });
  });
  it('leaves employer boards to placements', () => {
    expect(link({ sourceId: 'ats-greenhouse-acme', company: 'Acme Robotics' })).toEqual({ status: 'skipped', reason: 'employer_board' });
    expect(link({ sourceId: 'src-company-li-acme', company: 'Acme Robotics' })).toEqual({ status: 'skipped', reason: 'employer_board' });
    expect(link({ sourceId: 'linkedin', company: 'Acme Robotics' })).toEqual({ status: 'linked', companyKey: 'acme', how: 'exact_name' });
  });
  it('skips hh individuals by flag and by name form', () => {
    expect(link({ sourceId: 'hh', company: 'Acme Robotics', employerIsPerson: true })).toEqual({ status: 'skipped', reason: 'person' });
    expect(link({ sourceId: 'hh', company: 'Иванов Иван Петрович' })).toEqual({ status: 'skipped', reason: 'person' });
  });
  it('skips generic and ambiguous names', () => {
    expect(link({ sourceId: 'src-remotive', company: 'Confidential' })).toEqual({ status: 'skipped', reason: 'generic' });
    expect(link({ sourceId: 'src-remotive', company: 'Nova' })).toEqual({ status: 'skipped', reason: 'ambiguous' });
    expect(link({ sourceId: 'src-remotive', company: 'Unknown Ltd' })).toEqual({ status: 'skipped', reason: 'generic' });
    expect(link({ sourceId: 'src-remotive', company: 'Globex' })).toEqual({ status: 'skipped', reason: 'unlinked' });
  });
  it('drops matches that only meet after group and plus are stripped', () => {
    expect(link({ sourceId: 'hh', company: 'Леон +' })).toEqual({ status: 'skipped', reason: 'loose_name' });
    expect(link({ sourceId: 'src-indeed', company: 'Alchemy Group' })).toEqual({ status: 'skipped', reason: 'loose_name' });
  });
});
