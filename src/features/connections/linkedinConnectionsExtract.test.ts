// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  companyFromHeadline,
  extractLinkedInConnections,
  toConnectionImportContacts,
} from './linkedinConnectionsExtract';

const fixture = readFileSync(
  join(__dirname, '__fixtures__/linkedin/connections-provisional.html'),
  'utf8',
);

describe('LinkedIn 1st-degree connections extract (B448)', () => {
  it('reads one entry per profile with name, headline and canonical URL', () => {
    const connections = extractLinkedInConnections(fixture);
    expect(connections).toHaveLength(4);
    expect(connections[0]).toEqual({
      fullName: 'Ирина Котова',
      headline: 'Head of QA at Север Тех',
      linkedinUrl: 'https://www.linkedin.com/in/irina-kotova-test/',
    });
    expect(connections[1]?.linkedinUrl).toBe('https://www.linkedin.com/in/petr-volkov-test/');
  });

  it('takes the current company from the headline', () => {
    expect(companyFromHeadline('Head of QA at Север Тех')).toEqual({
      roleTitle: 'Head of QA',
      companyName: 'Север Тех',
    });
    expect(companyFromHeadline('Engineering Manager в Вектор Банк | Платформа данных')).toEqual({
      roleTitle: 'Engineering Manager',
      companyName: 'Вектор Банк',
    });
    expect(companyFromHeadline('Recruiter @ Лента Групп')?.companyName).toBe('Лента Групп');
    expect(companyFromHeadline('Product enthusiast')).toBeNull();
  });

  it('keeps only contacts with a company and caps the batch', () => {
    const contacts = toConnectionImportContacts(extractLinkedInConnections(fixture), 2);
    expect(contacts).toEqual([
      {
        fullName: 'Ирина Котова',
        companyName: 'Север Тех',
        roleTitle: 'Head of QA',
        linkedinUrl: 'https://www.linkedin.com/in/irina-kotova-test/',
      },
      {
        fullName: 'Петр Волков',
        companyName: 'Вектор Банк',
        roleTitle: 'Engineering Manager',
        linkedinUrl: 'https://www.linkedin.com/in/petr-volkov-test/',
      },
    ]);
  });

  it('returns nothing for a page without profile links', () => {
    expect(extractLinkedInConnections('<main><p>Войдите</p></main>')).toEqual([]);
  });
});
