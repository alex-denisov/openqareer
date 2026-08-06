import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  ingestLinkedInArchiveFiles,
  ingestLinkedInArchiveZip,
  parseCsvRows,
} from './linkedinArchive';

describe('LinkedIn candidate-owned archive ingestion', () => {
  it('parses quoted commas, escaped quotes and newlines without a third-party upload', () => {
    expect(
      parseCsvRows(
        'Title,Company Name,Description\r\n"Product, Lead",Example,"Built a ""safe"" workflow.\nSecond line"',
      ),
    ).toEqual([
      {
        title: 'Product, Lead',
        'company name': 'Example',
        description: 'Built a "safe" workflow.\nSecond line',
      },
    ]);
  });

  it('imports supported CSV files into facts that still require confirmation', () => {
    const result = ingestLinkedInArchiveFiles(
      {
        'Profile.csv':
          'Headline,Summary,Geo Location\nProduct Lead,"Synthetic, candidate summary",Berlin',
        'Positions.csv':
          'Company Name,Title,Description,Location,Started On,Finished On\nExample GmbH,Product Lead,Improved a synthetic metric by 25%,Berlin,Jan 2022,',
        'Education.csv':
          'School Name,Degree Name,Start Date,End Date\nExample University,MSc,2015,2017',
        'Skills.csv': 'Name\nProduct Strategy\nproduct strategy\nOperations',
      },
      {
        sourceId: 'synthetic-linkedin-archive',
        capturedAt: '2026-08-06T12:00:00.000Z',
      },
    );

    expect(result.state).toBe('ready_for_confirmation');
    if (result.state !== 'ready_for_confirmation') throw new Error('unexpected');
    expect(result.facts.map((fact) => fact.kind)).toEqual([
      'headline',
      'summary',
      'location',
      'position',
      'education',
      'skill',
      'skill',
    ]);
    expect(result.facts.every((fact) => fact.status === 'proposed')).toBe(true);
    expect(result.facts[0].provenance).toMatchObject({
      platform: 'linkedin',
      accessPath: 'candidate_export',
      rawSourceState: 'available',
    });
  });

  it('rejects malformed or irrelevant archives explicitly', () => {
    expect(() => parseCsvRows('Name\n"unterminated')).toThrow(
      'linkedin_archive_csv_invalid',
    );
    expect(() =>
      ingestLinkedInArchiveFiles(
        { 'Connections.csv': 'First Name,Last Name\nSynthetic,Person' },
        {
          sourceId: 'synthetic-linkedin-archive',
          capturedAt: '2026-08-06T12:00:00.000Z',
        },
      ),
    ).toThrow('linkedin_archive_has_no_supported_profile_files');
  });

  it('reads only supported files from a bounded candidate-owned ZIP export', async () => {
    const archive = zipSync({
      'Complete_LinkedInDataExport/Profile.csv': strToU8(
        'Headline,Summary,Geo Location\nSynthetic Lead,Synthetic summary,Berlin',
      ),
      'Complete_LinkedInDataExport/Skills.csv': strToU8(
        'Name\nProduct Operations',
      ),
      'Complete_LinkedInDataExport/Connections.csv': strToU8(
        'First Name,Last Name\nThird,Party',
      ),
    });

    const result = await ingestLinkedInArchiveZip(archive, {
      sourceId: 'synthetic-linkedin-zip',
      capturedAt: '2026-08-06T12:00:00.000Z',
    });

    expect(result.state).toBe('ready_for_confirmation');
    if (result.state !== 'ready_for_confirmation') throw new Error('unexpected');
    expect(result.facts.map((fact) => fact.statement)).toEqual([
      'Synthetic Lead',
      'Synthetic summary',
      'Berlin',
      'Product Operations',
    ]);
    expect(
      result.facts.some((fact) => fact.statement.includes('Third')),
    ).toBe(false);
  });
});
