import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { relocationLanguageSourceLabel, removeRelocationItem } from './relocationProfileItems';

function filledProfile() {
  const profile = emptyRelocationQuestionnaire();
  return {
    ...profile,
    citizenshipDocuments: {
      citizenshipCountryCodes: ['RU', 'RS'],
      documents: [{ id: 'doc-1', kind: 'residence_permit' as const, countryCode: 'RS' }],
    },
    languages: {
      languages: [
        {
          id: 'lang-1',
          name: 'Английский',
          level: 'C1' as const,
          source: 'candidate' as const,
          confirmation: 'confirmed' as const,
        },
      ],
    },
  };
}

describe('removeRelocationItem', () => {
  it('removes one document and keeps the rest of the step untouched', () => {
    const profile = filledProfile();
    const next = removeRelocationItem(profile, 'citizenship_documents', 'doc-1');
    expect(next.citizenshipDocuments.documents).toEqual([]);
    expect(next.citizenshipDocuments.citizenshipCountryCodes).toEqual(['RU', 'RS']);
    expect(profile.citizenshipDocuments.documents).toHaveLength(1);
  });

  it('removes one citizenship by its row id', () => {
    const next = removeRelocationItem(filledProfile(), 'citizenship_documents', 'citizenship:RS');
    expect(next.citizenshipDocuments.citizenshipCountryCodes).toEqual(['RU']);
  });

  it('removes one language', () => {
    expect(
      removeRelocationItem(filledProfile(), 'languages', 'lang-1').languages.languages,
    ).toEqual([]);
  });
});

describe('relocationLanguageSourceLabel', () => {
  it('never shows the raw source code', () => {
    expect(relocationLanguageSourceLabel('candidate')).toBe('со слов кандидата');
    expect(relocationLanguageSourceLabel('linkedin')).toBe('из LinkedIn');
  });
});
