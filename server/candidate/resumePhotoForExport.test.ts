import { describe, expect, it } from 'vitest';
import { resumePhotoForExport, type ResumePhotoDeps } from './resumePhotoForExport';

const BYTES = Buffer.from([0xff, 0xd8, 0xff]);

function deps(inResume: boolean, photoMediaId?: string): ResumePhotoDeps {
  return {
    setting: { inResume: () => inResume },
    store: {
      getSnapshot: () => ({ resume: { draft: { candidate: { photoMediaId } } } }) as never,
      getCandidateMedia: (_candidate, mediaId) =>
        mediaId === 'p1' ? { mime: 'image/jpeg', bytes: BYTES } : null,
    },
  };
}

describe('B666: фото для файла резюме', () => {
  it('включено и фото есть — фото в шапке', () => {
    expect(resumePhotoForExport(deps(true, 'p1'), 'c1')).toEqual({ bytes: BYTES, format: 'jpg' });
  });
  it('выключено — фото нет, даже если оно в профиле', () => {
    expect(resumePhotoForExport(deps(false, 'p1'), 'c1')).toBeNull();
  });
  it('включено, а фото в профиле нет — без фото', () => {
    expect(resumePhotoForExport(deps(true), 'c1')).toBeNull();
  });
});
