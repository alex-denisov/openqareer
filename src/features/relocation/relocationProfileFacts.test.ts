import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { ResumeDraft } from '../resume/resumeTypes';
import {
  applyRelocationStepToDraft,
  isProfileFactRow,
  mergeProfileFacts,
} from './relocationProfileFacts';

/** OWNER_TEST on prod, 26.10: a LinkedIn import with two diplomas, two languages and certificates. */
const ownerDraft: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [
    {
      id: 'imp6324433e42-edu-1',
      evidenceMemoryId: 'impe6331f9e62-edu-1',
      institution: 'Geekbrains',
      qualification: 'Professional Program, DevOps Engineering',
      startDate: 'Oct 2021',
      endDate: 'Apr 2023',
    },
    {
      id: 'imp6324433e42-edu-2',
      evidenceMemoryId: 'impe6331f9e62-edu-2',
      institution: 'Universitatea Tehnică a Moldovei',
      qualification: 'Bachelor of Engineering - BE, Information Technology',
      startDate: '2005',
      endDate: '2010',
    },
  ],
  languages: [
    {
      id: 'imp-lang-1',
      evidenceMemoryId: 'imp-lang-1',
      name: 'English',
      cefr: 'C1',
      sourceLabel: 'Full professional proficiency',
    },
    { id: 'imp-lang-2', evidenceMemoryId: 'imp-lang-2', name: 'Russian', cefr: 'C2' },
  ],
  certifications: [{ id: 'cert-1', name: 'CKA', issuer: 'CNCF', issuedAt: '2022-05' }],
};

describe('mergeProfileFacts', () => {
  it('shows the diplomas of the profile as known education, with the level read from the qualification', () => {
    const merged = mergeProfileFacts(emptyRelocationQuestionnaire(), ownerDraft);
    const bachelor = merged.education.education.find(({ title }) => title.startsWith('Bachelor'));
    expect(merged.education.education).toHaveLength(2);
    expect(bachelor).toMatchObject({
      level: 'bachelor',
      fieldOfStudy: 'Universitatea Tehnică a Moldovei',
      startedAt: '2005-01-01',
      completedAt: '2010-12-31',
      recognitionStatus: 'unknown',
    });
    expect(isProfileFactRow(bachelor?.id ?? '')).toBe(true);
    expect(merged.education.education[0]?.completedAt).toBe('2023-04-01');
    // «DevOps Engineering» names a field, not a bachelor degree.
    expect(merged.education.education[0]?.level).toBe('other');
  });

  it('takes languages with their level in Russian names and certificates', () => {
    const merged = mergeProfileFacts(emptyRelocationQuestionnaire(), ownerDraft);
    expect(merged.languages.languages.map(({ name, level }) => `${name} ${level}`)).toEqual([
      'Английский C1',
      'Русский C2',
    ]);
    expect(merged.education.certificates[0]).toMatchObject({ title: 'CKA', issuer: 'CNCF' });
  });

  it('reads citizenship of the profile into country codes', () => {
    const draft: ResumeDraft = { ...ownerDraft, additional: { citizenship: 'Молдова, Russia' } };
    const merged = mergeProfileFacts(emptyRelocationQuestionnaire(), draft);
    expect(merged.citizenshipDocuments.citizenshipCountryCodes).toEqual(['MD', 'RU']);
  });

  it('keeps what the candidate saved in relocation and does not duplicate it', () => {
    const saved = mergeProfileFacts(emptyRelocationQuestionnaire(), ownerDraft);
    const edited = {
      ...saved,
      education: {
        ...saved.education,
        education: saved.education.education.map((row) => ({ ...row, countryCode: 'MD' })),
      },
      citizenshipDocuments: { citizenshipCountryCodes: ['MD'], documents: [] },
    };
    const merged = mergeProfileFacts(edited, {
      ...ownerDraft,
      additional: { citizenship: 'Россия' },
    });
    expect(merged.education.education.map(({ countryCode }) => countryCode)).toEqual(['MD', 'MD']);
    expect(merged.languages.languages).toHaveLength(2);
    expect(merged.citizenshipDocuments.citizenshipCountryCodes).toEqual(['MD']);
  });

  it('returns the questionnaire unchanged without a profile', () => {
    const questionnaire = emptyRelocationQuestionnaire();
    expect(mergeProfileFacts(questionnaire, null)).toBe(questionnaire);
  });
});

describe('applyRelocationStepToDraft', () => {
  it('writes citizenship into the profile, where it has no field of its own', () => {
    const questionnaire = {
      ...emptyRelocationQuestionnaire(),
      citizenshipDocuments: { citizenshipCountryCodes: ['MD', 'RO'], documents: [] },
    };
    const next = applyRelocationStepToDraft(ownerDraft, 'citizenship_documents', questionnaire);
    expect(next?.additional?.citizenship).toBe('Молдова, Румыния');
    expect(ownerDraft.additional).toBeUndefined();
  });

  it('adds education and languages entered in relocation, and skips the ones from the profile', () => {
    const merged = mergeProfileFacts(emptyRelocationQuestionnaire(), ownerDraft);
    const questionnaire = {
      ...merged,
      education: {
        ...merged.education,
        education: [
          ...merged.education.education,
          {
            id: 'abc-1',
            level: 'master' as const,
            title: 'MSc Computer Science',
            countryCode: 'DE',
            recognitionStatus: 'recognized' as const,
          },
        ],
      },
      languages: {
        languages: [
          ...merged.languages.languages,
          {
            id: 'lang-x',
            name: 'Немецкий',
            level: 'B1' as const,
            source: 'candidate' as const,
            confirmation: 'confirmed' as const,
          },
        ],
      },
    };
    const withEducation = applyRelocationStepToDraft(ownerDraft, 'education', questionnaire);
    expect(withEducation?.education).toHaveLength(3);
    expect(withEducation?.education.at(-1)).toMatchObject({
      qualification: 'MSc Computer Science',
    });
    const withLanguages = applyRelocationStepToDraft(ownerDraft, 'languages', questionnaire);
    expect(withLanguages?.languages.map(({ name }) => name)).toEqual([
      'English',
      'Russian',
      'Немецкий',
    ]);
    expect(
      mergeProfileFacts(questionnaire, withEducation ?? ownerDraft).education.education,
    ).toHaveLength(3);
  });

  it('returns null when the profile already holds everything', () => {
    const merged = mergeProfileFacts(emptyRelocationQuestionnaire(), ownerDraft);
    expect(applyRelocationStepToDraft(ownerDraft, 'education', merged)).toBeNull();
    expect(applyRelocationStepToDraft(ownerDraft, 'family', merged)).toBeNull();
  });
});
