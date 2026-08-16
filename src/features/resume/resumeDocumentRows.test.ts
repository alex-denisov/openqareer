import { describe, expect, it } from 'vitest';
import {
  mergeEducation,
  mergeExperience,
  mergeLanguages,
  usedEvidenceIds,
} from './resumeDocumentRows';
import type {
  ResumeAssertion,
  ResumeDocument,
  ResumeDraft,
  ResumeExperience,
} from './resumeTypes';

function assertion(value: string, memoryId = 'memory-1'): ResumeAssertion {
  return { value, memoryId, sourceMessageIds: ['message-1'], reviewFlags: [] };
}

function draftEntry(
  id: string,
  overrides: Partial<ResumeDraft['experience'][number]> = {},
): ResumeDraft['experience'][number] {
  return {
    id,
    chronologyMemoryId: `chronology-${id}`,
    current: false,
    bulletMemoryIds: [],
    ...overrides,
  };
}

function projectedEntry(id: string): ResumeExperience {
  return {
    id,
    title: assertion(`Роль ${id}`),
    employer: null,
    location: null,
    startDate: null,
    endDate: null,
    current: {
      value: false,
      memoryId: `chronology-${id}`,
      sourceMessageIds: ['message-1'],
      reviewFlags: [],
    },
    bullets: [],
  };
}

function documentOf(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    kind: 'master',
    targetRole: null,
    contact: { fullName: null, email: null, phone: null, location: null, links: [] },
    experience: [],
    education: [],
    languages: [],
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: false,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 4, pages: 1, linesPerPage: 45 },
    ...overrides,
  };
}

const emptyDraft: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
};

describe('resume document rows', () => {
  it('follows the projected order, so German reverse chronology is what the candidate sees', () => {
    const draft: ResumeDraft = {
      ...emptyDraft,
      experience: [draftEntry('older'), draftEntry('newer')],
    };
    const document = documentOf({
      experience: [projectedEntry('newer'), projectedEntry('older')],
    });
    expect(mergeExperience(draft, document).map((row) => row.entry.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('keeps an entry the engine refused visible and editable at the end', () => {
    const draft: ResumeDraft = {
      ...emptyDraft,
      experience: [draftEntry('kept'), draftEntry('revoked')],
    };
    const rows = mergeExperience(draft, documentOf({ experience: [projectedEntry('kept')] }));
    expect(rows.map((row) => row.entry.id)).toEqual(['kept', 'revoked']);
    expect(rows[1]?.projected).toBeUndefined();
  });

  it('reconstructs an editable row when only the projection is available', () => {
    const rows = mergeExperience(
      emptyDraft,
      documentOf({ experience: [projectedEntry('only-projected')] }),
    );
    expect(rows[0]?.entry.title).toBe('Роль only-projected');
    expect(rows[0]?.entry.chronologyMemoryId).toBe('chronology-only-projected');
  });

  it('merges education and languages the same way', () => {
    const draft: ResumeDraft = {
      ...emptyDraft,
      education: [{ id: 'edu-1', evidenceMemoryId: 'memory-edu' }],
      languages: [{ id: 'lang-1', evidenceMemoryId: 'memory-lang' }],
    };
    const document = documentOf({
      education: [
        {
          id: 'edu-1',
          institution: assertion('МГУ', 'memory-edu'),
          qualification: null,
          startDate: null,
          endDate: null,
        },
      ],
      languages: [
        {
          id: 'lang-2',
          name: assertion('Немецкий', 'memory-de'),
          cefr: null,
        },
      ],
    });
    expect(mergeEducation(draft, document).map((entry) => entry.id)).toEqual(['edu-1']);
    expect(mergeLanguages(draft, document).map((entry) => entry.id)).toEqual([
      'lang-2',
      'lang-1',
    ]);
  });

  it('reconstructs rows even when the projection carries no optional assertion', () => {
    const document = documentOf({
      experience: [{ ...projectedEntry('bare'), title: null }],
      education: [
        {
          id: 'edu-bare',
          institution: null,
          qualification: null,
          startDate: null,
          endDate: null,
        },
      ],
      languages: [{ id: 'lang-bare', name: null, cefr: null }],
    });
    const experience = mergeExperience(emptyDraft, document);
    expect(experience[0]?.entry.title).toBeUndefined();
    expect(mergeEducation(emptyDraft, document)[0]?.evidenceMemoryId).toBe('');
    expect(mergeLanguages(emptyDraft, document)[0]?.evidenceMemoryId).toBe('');
  });

  it('keeps the qualification and CEFR provenance when the first field is empty', () => {
    const document = documentOf({
      education: [
        {
          id: 'edu-2',
          institution: null,
          qualification: assertion('Магистр', 'memory-qualification'),
          startDate: null,
          endDate: null,
        },
      ],
      languages: [
        {
          id: 'lang-2',
          name: null,
          cefr: {
            value: 'C1',
            memoryId: 'memory-cefr',
            sourceMessageIds: ['message-1'],
            reviewFlags: [],
          },
        },
      ],
    });
    expect(mergeEducation(emptyDraft, document)[0]?.evidenceMemoryId).toBe(
      'memory-qualification',
    );
    expect(mergeLanguages(emptyDraft, document)[0]?.evidenceMemoryId).toBe('memory-cefr');
  });

  it('collects every memory id the draft already spends', () => {
    const draft: ResumeDraft = {
      ...emptyDraft,
      experience: [draftEntry('a', { bulletMemoryIds: ['bullet-1', 'bullet-2'] })],
      education: [{ id: 'edu-1', evidenceMemoryId: 'memory-edu' }],
      languages: [{ id: 'lang-1', evidenceMemoryId: 'memory-lang' }],
    };
    expect([...usedEvidenceIds(draft)].sort()).toEqual([
      'bullet-1',
      'bullet-2',
      'chronology-a',
      'memory-edu',
      'memory-lang',
    ]);
  });
});
