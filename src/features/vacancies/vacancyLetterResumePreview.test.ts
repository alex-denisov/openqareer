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

  it('reads the version the approval attached, without preparing a new one', async () => {
    const prepare = vi.spyOn(letterApi, 'prepareVacancyLetterResume');
    vi.spyOn(versionsApi, 'getResumeVersion').mockResolvedValue(version('v-1'));
    vi.spyOn(resumeExport, 'formatTargetedResumeAsAtsText').mockReturnValue('ИВАН ИВАНОВ');
    const preview = await loadLetterResumePreview('cluster-1', {
      kind: 'targeted',
      versionId: 'v-1',
      documentId: 'd',
      snapshotAt: '2026-11-10T00:00:00.000Z',
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(preview).toEqual({ kind: 'targeted', title: 'Резюме под вакансию', text: 'ИВАН ИВАНОВ' });
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
    await expect(loadLetterResumePreview('cluster-1', null)).resolves.toEqual({
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
