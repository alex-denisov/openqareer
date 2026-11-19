import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import { setup, type Candidates } from './testHelpers/letterApprovalHarness';

/**
 * B713: 19.11 живой отклик COO (hh 139180469). Требования вакансии по-русски не совпали дословно
 * с английским профилем, и «Резюме под эту вакансию» перечисляло одни должности без пунктов.
 */
function seedDescribedResume(candidates: Candidates, candidateId: string): void {
  const ids = ['import:b713:role', 'import:b713:b1', 'import:b713:b2'] as const;
  candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'synthetic',
    entries: [
      { memoryId: ids[0], domain: 'role-evidence', statement: 'VP of Technology, Example Grid, since 2021.' },
      { memoryId: ids[1], domain: 'outcome', statement: 'Rebuilt the support organisation of 250 people.' },
      { memoryId: ids[2], domain: 'responsibility', statement: 'Ran the yearly IT budget and vendor contracts.' },
    ],
  } as never);
  candidates.reviewMemories(candidateId, [...ids], 'confirm');
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    candidate: { fullName: 'Мила Пример' },
    experience: [{
      id: 'exp-1',
      chronologyMemoryId: ids[0],
      title: 'VP of Technology',
      employer: 'Example Grid',
      startDate: '2021-01',
      current: true,
      bulletMemoryIds: [ids[1], ids[2]],
    }],
  };
  candidates.saveResumeDraft(candidateId, draft, []);
}

describe('B713: резюме под вакансию с описаниями опыта', () => {
  it('версия под вакансию без дословных совпадений хранит пункты каждого места работы', async () => {
    const { candidates, candidateId, prepareResume } = await setup();
    seedDescribedResume(candidates, candidateId);

    const response = await prepareResume();
    expect(response.statusCode).toBe(200);
    const { versionId } = response.json().data as { versionId: string };
    const version = candidates.getResumeVersion(candidateId, versionId);
    const place = version?.snapshot.document.experience[0];

    expect(version?.snapshot.matchedRequirements).toEqual([]);
    expect(place?.bullets.map((bullet) => bullet.value)).toEqual([
      'Rebuilt the support organisation of 250 people.',
      'Ran the yearly IT budget and vendor contracts.',
    ]);
    expect(version?.snapshot.compressedExperienceIds).toEqual([]);
  });
});
