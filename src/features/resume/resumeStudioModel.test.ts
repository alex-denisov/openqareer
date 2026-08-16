import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import {
  addEducation,
  addExperience,
  addLanguage,
  defaultMobilePane,
  draftOf,
  eligibleEvidence,
  orderUnknowns,
  previewProjection,
  removeEducation,
  removeExperience,
  removeLanguage,
  selectDocument,
  setTargetRole,
  summarizeResumeStudio,
  toSavePayload,
  toggleBullet,
  updateCandidate,
  updateEducation,
  updateExperience,
  updateLanguage,
} from './resumeStudioModel';
import type { ResumeDocument, ResumeStudioView, ResumeUnknown } from './resumeTypes';

function memory(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: 'memory-1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Сократил подготовку отчётности с 2 дней до 20 минут.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['message-1'],
    sensitive: false,
    status: 'confirmed',
    ...overrides,
  };
}

function unknown(overrides: Partial<ResumeUnknown> = {}): ResumeUnknown {
  return {
    code: 'missing-full-name',
    message: 'Имя не указано.',
    scope: 'both',
    blocking: true,
    ...overrides,
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

function viewOf(overrides: Partial<ResumeStudioView> = {}): ResumeStudioView {
  return {
    draft: null,
    savedAt: null,
    projection: {
      master: documentOf(),
      germanyVariant: documentOf({
        kind: 'country-role',
        conventions: {
          country: 'DE',
          packVersion: 'DE-CV-2026.1',
          reverseChronological: true,
          maxPages: 2,
          recommendedBulletsPerRole: { min: 3, max: 5 },
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
      }),
      evidenceSnapshot: [],
      excludedEvidenceIds: [],
    },
    evidenceFreshness: { valid: true, stale: [] },
    ...overrides,
  };
}

describe('resume studio model', () => {
  describe('live preview projection', () => {
    it('rebuilds the document from unsaved edits, so a typed name closes its unknown', () => {
      const before = previewProjection(draftOf(viewOf()), []);
      expect(before.master.unknowns.map((item) => item.code)).toContain('missing-full-name');
      const after = previewProjection(
        updateCandidate(draftOf(viewOf()), { fullName: 'Елена Тарасова' }),
        [],
      );
      expect(after.master.unknowns.map((item) => item.code)).not.toContain(
        'missing-full-name',
      );
      expect(after.master.contact.fullName).toBe('Елена Тарасова');
    });

    it('projects a bullet as soon as it is attached, before any save', () => {
      const base = addExperience(draftOf(viewOf()), 'memory-1');
      const attached = toggleBullet(base, base.experience[0]!.id, 'memory-2');
      const projection = previewProjection(attached, [
        memory({ id: 'memory-1', statement: 'Руководила операциями с 2022 года.' }),
        memory({ id: 'memory-2', statement: 'Сократила цикл поставки на 30%.' }),
      ]);
      expect(projection.master.experience[0]?.bullets.map((item) => item.value)).toEqual([
        'Сократила цикл поставки на 30%.',
      ]);
    });

    it('excludes evidence the engine refuses even in the live preview', () => {
      const base = addExperience(draftOf(viewOf()), 'memory-1');
      const projection = previewProjection(
        toggleBullet(base, base.experience[0]!.id, 'unconfirmed'),
        [
          memory({ id: 'memory-1' }),
          memory({ id: 'unconfirmed', status: 'proposed' }),
        ],
      );
      expect(projection.excludedEvidenceIds).toContain('unconfirmed');
    });
  });

  describe('status summary', () => {
    it('counts blocking and open unknowns of the selected variant only', () => {
      const view = viewOf({
        projection: {
          ...viewOf().projection,
          master: documentOf({ unknowns: [unknown()] }),
          germanyVariant: documentOf({
            kind: 'country-role',
            unknowns: [
              unknown(),
              unknown({
                code: 'germany-length-exceeds-two-pages',
                scope: 'DE',
                blocking: false,
              }),
            ],
          }),
        },
      });
      expect(summarizeResumeStudio(view.projection, 'master', 0).blocking).toBe(1);
      expect(summarizeResumeStudio(view.projection, 'master', 0).open).toBe(0);
      expect(summarizeResumeStudio(view.projection, 'germany', 0).open).toBe(1);
    });

    it('reports stale evidence so a revoked fact is never presented as ready', () => {
      const view = viewOf({
        evidenceFreshness: {
          valid: false,
          stale: [{ memoryId: 'memory-1', reasons: ['missing'] }],
        },
      });
      const summary = summarizeResumeStudio(
        view.projection,
        'master',
        view.evidenceFreshness.stale.length,
      );
      expect(summary.staleEvidence).toBe(1);
      expect(summary.tone).toBe('blocked');
    });

    it('is ready only when nothing blocks and no evidence went stale', () => {
      expect(summarizeResumeStudio(viewOf().projection, 'master', 0).tone).toBe('ready');
    });

    it('treats a non-blocking unknown as attention rather than ready or blocked', () => {
      const view = viewOf({
        projection: {
          ...viewOf().projection,
          master: documentOf({ unknowns: [unknown({ blocking: false })] }),
        },
      });
      expect(summarizeResumeStudio(view.projection, 'master', 0).tone).toBe('attention');
    });

    it('exposes the page estimate against the country page limit', () => {
      const summary = summarizeResumeStudio(viewOf().projection, 'germany', 0);
      expect(summary.pages).toBe(1);
      expect(summary.maxPages).toBe(2);
      expect(summarizeResumeStudio(viewOf().projection, 'master', 0).maxPages).toBeNull();
    });
  });

  describe('variant selection', () => {
    it('selects the Germany document for the country variant', () => {
      expect(selectDocument(viewOf().projection, 'germany').kind).toBe('country-role');
      expect(selectDocument(viewOf().projection, 'master').kind).toBe('master');
    });
  });

  describe('unknown ordering', () => {
    it('puts blocking unknowns first and keeps the engine order inside a group', () => {
      const ordered = orderUnknowns([
        unknown({ code: 'germany-bullet-count', blocking: false }),
        unknown({ code: 'missing-full-name', blocking: true }),
        unknown({ code: 'missing-contact', blocking: true }),
      ]);
      expect(ordered.map((item) => item.code)).toEqual([
        'missing-full-name',
        'missing-contact',
        'germany-bullet-count',
      ]);
    });
  });

  describe('mobile first screen', () => {
    it('opens on the work to do when something blocks the resume', () => {
      const view = viewOf({
        projection: {
          ...viewOf().projection,
          master: documentOf({ unknowns: [unknown()] }),
        },
      });
      expect(defaultMobilePane(view.projection, 'master', 0)).toBe('unknowns');
    });

    it('opens on the document when there is nothing to clarify', () => {
      expect(defaultMobilePane(viewOf().projection, 'master', 0)).toBe('document');
    });
  });

  describe('evidence offered to the candidate', () => {
    it('offers only evidence the engine will accept', () => {
      const offered = eligibleEvidence([
        memory({ id: 'ok' }),
        memory({ id: 'proposed', status: 'proposed' }),
        memory({ id: 'hypothesis', kind: 'hypothesis' }),
        memory({ id: 'sensitive', sensitive: true }),
        memory({ id: 'orphan', sourceMessageIds: [] }),
      ]);
      expect(offered.map((item) => item.id)).toEqual(['ok']);
    });

    it('keeps a corrected fact available', () => {
      const offered = eligibleEvidence([memory({ id: 'fixed', status: 'corrected' })]);
      expect(offered.map((item) => item.id)).toEqual(['fixed']);
    });
  });

  describe('draft editing stays immutable', () => {
    it('adds an experience entry bound to its chronology memory', () => {
      const draft = addExperience(draftOf(viewOf()), 'memory-1');
      expect(draft.experience).toHaveLength(1);
      expect(draft.experience[0]?.chronologyMemoryId).toBe('memory-1');
      expect(draft.experience[0]?.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
      expect(draft.experience[0]?.current).toBe(false);
    });

    it('never mutates the draft it was given', () => {
      const before = draftOf(viewOf());
      const after = addExperience(before, 'memory-1');
      expect(before.experience).toHaveLength(0);
      expect(after).not.toBe(before);
    });

    it('edits one entry and leaves the others untouched', () => {
      const base = addExperience(addExperience(draftOf(viewOf()), 'a'), 'b');
      const first = base.experience[0]!;
      const edited = updateExperience(base, first.id, { title: 'Аналитик' });
      expect(edited.experience[0]?.title).toBe('Аналитик');
      expect(edited.experience[1]).toEqual(base.experience[1]);
    });

    it('attaches and detaches a bullet by memory id', () => {
      const base = addExperience(draftOf(viewOf()), 'chronology');
      const id = base.experience[0]!.id;
      const attached = toggleBullet(base, id, 'memory-1');
      expect(attached.experience[0]?.bulletMemoryIds).toEqual(['memory-1']);
      expect(toggleBullet(attached, id, 'memory-1').experience[0]?.bulletMemoryIds).toEqual(
        [],
      );
    });

    it('refuses to attach more bullets than the schema accepts', () => {
      const base = addExperience(draftOf(viewOf()), 'chronology');
      const id = base.experience[0]!.id;
      const filled = Array.from({ length: 13 }, (_, index) => `memory-${index}`).reduce(
        (draft, memoryId) => toggleBullet(draft, id, memoryId),
        base,
      );
      expect(filled.experience[0]?.bulletMemoryIds).toHaveLength(12);
    });

    it('removes an experience entry by id', () => {
      const base = addExperience(draftOf(viewOf()), 'memory-1');
      expect(removeExperience(base, base.experience[0]!.id).experience).toHaveLength(0);
    });

    it('adds education and language entries bound to their evidence', () => {
      const withEducation = addEducation(draftOf(viewOf()), 'edu-memory');
      expect(withEducation.education[0]?.evidenceMemoryId).toBe('edu-memory');
      const withLanguage = addLanguage(withEducation, 'lang-memory');
      expect(withLanguage.languages[0]?.evidenceMemoryId).toBe('lang-memory');
      expect(withLanguage.education).toHaveLength(1);
    });

    it('updates contact fields without dropping the others', () => {
      const draft = updateCandidate(draftOf(viewOf()), { fullName: 'Елена Тарасова' });
      const withEmail = updateCandidate(draft, { email: 'elena@example.com' });
      expect(withEmail.candidate.fullName).toBe('Елена Тарасова');
      expect(withEmail.candidate.contact?.email).toBe('elena@example.com');
    });
  });

  describe('the remaining editing operations', () => {
    it('sets the target role that drives the country variant', () => {
      expect(setTargetRole(draftOf(viewOf()), 'Product Analyst').targetRole).toBe(
        'Product Analyst',
      );
    });

    it('edits and removes an education entry', () => {
      const base = addEducation(draftOf(viewOf()), 'edu-memory');
      const id = base.education[0]!.id;
      const edited = updateEducation(base, id, { institution: 'МГУ' });
      expect(edited.education[0]?.institution).toBe('МГУ');
      expect(removeEducation(edited, id).education).toHaveLength(0);
    });

    it('edits and removes a language entry', () => {
      const base = addLanguage(draftOf(viewOf()), 'lang-memory');
      const id = base.languages[0]!.id;
      const edited = updateLanguage(base, id, { name: 'Немецкий', cefr: 'B2' });
      expect(edited.languages[0]?.cefr).toBe('B2');
      expect(removeLanguage(edited, id).languages).toHaveLength(0);
    });

    it('leaves an unrelated entry untouched when the id does not match', () => {
      const base = addExperience(draftOf(viewOf()), 'memory-1');
      expect(updateExperience(base, 'missing-id', { title: 'x' })).toEqual(base);
      expect(removeExperience(base, 'missing-id').experience).toHaveLength(1);
      expect(toggleBullet(base, 'missing-id', 'memory-2')).toEqual(base);
    });

    it('caps the stored links at the schema maximum', () => {
      const links = Array.from({ length: 14 }, (_, index) => `https://example.com/${index}`);
      expect(updateCandidate(draftOf(viewOf()), { links }).candidate.contact?.links).toHaveLength(
        10,
      );
    });

    it('returns the saved draft when the view carries one', () => {
      const saved = addExperience(draftOf(viewOf()), 'memory-1');
      expect(draftOf(viewOf({ draft: saved }))).toBe(saved);
    });
  });

  describe('save payload', () => {
    it('drops empty strings so a cleared field is absent rather than invalid', () => {
      const draft = updateCandidate(
        updateCandidate(draftOf(viewOf()), { fullName: 'Елена' }),
        { email: '   ' },
      );
      const payload = toSavePayload(draft);
      expect(payload.candidate.contact?.email).toBeUndefined();
      expect(payload.candidate.fullName).toBe('Елена');
    });

    it('drops blank links instead of sending an invalid URL', () => {
      const draft = updateCandidate(draftOf(viewOf()), {
        links: ['https://example.com/elena', '  '],
      });
      expect(toSavePayload(draft).candidate.contact?.links).toEqual([
        'https://example.com/elena',
      ]);
    });

    it('trims entry text and omits empty optional fields', () => {
      const base = addExperience(draftOf(viewOf()), 'memory-1');
      const edited = updateExperience(base, base.experience[0]!.id, {
        title: '  Продуктовый аналитик  ',
        employer: '',
      });
      const entry = toSavePayload(edited).experience[0]!;
      expect(entry.title).toBe('Продуктовый аналитик');
      expect(entry.employer).toBeUndefined();
      expect(entry.chronologyMemoryId).toBe('memory-1');
    });
  });
});
