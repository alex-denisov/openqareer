import { afterEach, describe, expect, it, vi } from 'vitest';
import * as letterApi from './vacancyLetterApi';
import * as versionsApi from '../resume/resumeVersionsApi';
import * as resumeApi from '../resume/resumeApi';
import * as resumeExport from '../resume/resumeExport';
import { loadLetterResumePreview } from './vacancyLetterResumePreview';

const version = (id: string) =>
  ({ version: { id, title: 'Head of Platform', snapshot: { document: {} } } }) as never;

describe('loadLetterResumePreview (B631)', () => {
  afterEach(() => vi.restoreAllMocks());

  const approved = {
    kind: 'targeted',
    versionId: 'v-1',
    documentId: 'd',
    snapshotAt: '2026-11-10T00:00:00.000Z',
  } as const;

  it.each([
    ['fresh version the server prepared', async () => ({ ready: true, versionId: 'v-9' }), 'v-9'],
    [
      'approved one when it is not prepared',
      async () => ({ ready: false, versionId: null }),
      'v-1',
    ],
    ['approved one when preparing fails', () => Promise.reject(new Error('503')), 'v-1'],
  ])('after approval reads the %s (B785)', async (_, prepare, versionId) => {
    vi.spyOn(letterApi, 'prepareVacancyLetterResume').mockImplementation(prepare);
    const read = vi.spyOn(versionsApi, 'getResumeVersion').mockResolvedValue(version(versionId));
    vi.spyOn(resumeExport, 'formatTargetedResumeAsAtsText').mockReturnValue('ИВАН ИВАНОВ');
    await expect(loadLetterResumePreview('cluster-1', approved)).resolves.toMatchObject({
      kind: 'targeted',
      text: 'ИВАН ИВАНОВ',
      versionId,
    });
    expect(read).toHaveBeenCalledWith(versionId, undefined);
  });

  it('before approval prepares the targeted version the letter will attach', async () => {
    vi.spyOn(letterApi, 'prepareVacancyLetterResume').mockResolvedValue({
      ready: true,
      versionId: 'v-2',
    });
    const read = vi.spyOn(versionsApi, 'getResumeVersion').mockResolvedValue(version('v-2'));
    vi.spyOn(resumeExport, 'formatTargetedResumeAsAtsText').mockReturnValue('текст');
    await expect(loadLetterResumePreview('cluster-1', null)).resolves.toMatchObject({
      kind: 'targeted',
      text: 'текст',
    });
    expect(read).toHaveBeenCalledWith('v-2', undefined);
  });

  it('without a targeted version shows the general resume from the profile (Free)', async () => {
    vi.spyOn(letterApi, 'prepareVacancyLetterResume').mockResolvedValue({
      ready: true,
      versionId: null,
    });
    vi.spyOn(resumeApi, 'getResumeStudio').mockResolvedValue({
      draft: null,
      projection: { master: {} },
    } as never);
    vi.spyOn(resumeExport, 'formatResumeAsAtsText').mockReturnValue('общее');
    await expect(loadLetterResumePreview('cluster-1', null)).resolves.toMatchObject({
      kind: 'master',
      title: 'Резюме',
      text: 'общее',
    });
  });

  it('says there is no resume when the profile has no work experience', async () => {
    vi.spyOn(letterApi, 'prepareVacancyLetterResume').mockResolvedValue({
      ready: false,
      versionId: null,
    });
    await expect(loadLetterResumePreview('cluster-1', null)).resolves.toMatchObject({
      kind: 'none',
      text: '',
    });
  });
});
