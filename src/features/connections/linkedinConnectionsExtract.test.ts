// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  companyFromHeadline,
  extractLinkedInConnections,
  toConnectionImportContacts,
} from './linkedinConnectionsExtract';

const fixture = readFileSync(join(__dirname, '__fixtures__/linkedin/connections.html'), 'utf8');

describe('LinkedIn 1st-degree connections extract (B448)', () => {
  it('reads one entry per profile with name, headline and canonical URL', () => {
    const connections = extractLinkedInConnections(fixture);
    expect(connections).toHaveLength(4);
    expect(connections[0]).toEqual({
      fullName: 'Ирина Котова',
      headline: 'Head of QA at Север Тех',
      linkedinUrl: 'https://www.linkedin.com/in/irina-kotova-test/',
    });
    expect(connections[1]).toEqual({
      fullName: 'Петр Волков',
      headline: 'Engineering Manager в Вектор Банк | Платформа данных',
      linkedinUrl: 'https://www.linkedin.com/in/petr-volkov-test/',
    });
    expect(connections.map((connection) => connection.headline)).not.toContain(
      'Connected on October 1, 2026',
    );
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

  it('keeps every contact, people with a company first, and caps the batch', () => {
    const contacts = toConnectionImportContacts(extractLinkedInConnections(fixture), 10);
    expect(contacts).toHaveLength(4);
    expect(contacts.slice(0, 2)).toEqual([
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
    const withoutCompany = contacts.at(-1);
    expect(withoutCompany?.companyName).toBe('');
    expect(withoutCompany?.roleTitle).not.toBe('');
    expect(toConnectionImportContacts(extractLinkedInConnections(fixture), 2)).toHaveLength(2);
  });

  it('returns nothing for a page without profile links', () => {
    expect(extractLinkedInConnections('<main><p>Войдите</p></main>')).toEqual([]);
  });

  it('reads the compact card list the desktop shell returns for long networks', () => {
    const compact =
      '<main><div><a href="/in/irina-kotova-test/"><p>Ирина Котова</p><p>Head of QA at Север Тех</p></a></div>' +
      '<div><a href="/in/oleg-smirnov-test/"><p>Олег Смирнов</p></a></div></main>';
    expect(extractLinkedInConnections(compact)).toEqual([
      {
        fullName: 'Ирина Котова',
        headline: 'Head of QA at Север Тех',
        linkedinUrl: 'https://www.linkedin.com/in/irina-kotova-test/',
      },
      {
        fullName: 'Олег Смирнов',
        headline: '',
        linkedinUrl: 'https://www.linkedin.com/in/oleg-smirnov-test/',
      },
    ]);
  });
});
