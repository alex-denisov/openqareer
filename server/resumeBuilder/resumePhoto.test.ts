import { unzipSync } from 'fflate';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { RESUME_TEMPLATES, SAMPLE_BUILDER_RESUME } from '../../shared/resumeBuilder/model';
import { renderResumeDocx } from './resumeDocx';
import { renderResumePdf } from './resumePdf';
import { resumePhotoOf } from './resumePhoto';

const JPEG = Buffer.from(
  jpeg.encode({ data: Buffer.alloc(40 * 40 * 4, 180), width: 40, height: 40 }, 90).data,
);
const PHOTO = resumePhotoOf({ mime: 'image/jpeg', bytes: JPEG })!;

const images = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/gu) ?? []).length;
const media = (docx: Buffer) =>
  Object.keys(unzipSync(new Uint8Array(docx))).filter(
    (name) => name.startsWith('word/media/') && !name.endsWith('/'),
  );

describe('B666: фото профиля в шапке резюме', () => {
  it.each(RESUME_TEMPLATES)(
    '%s: PDF с фото — одна картинка, без фото — ни одной',
    async (template) => {
      expect(images(await renderResumePdf(SAMPLE_BUILDER_RESUME, template, PHOTO))).toBe(1);
      expect(images(await renderResumePdf(SAMPLE_BUILDER_RESUME, template))).toBe(0);
    },
  );

  it('DOCX с фото несёт файл картинки, без фото — нет', async () => {
    expect(media(await renderResumeDocx(SAMPLE_BUILDER_RESUME, 'modern', PHOTO))).toHaveLength(1);
    expect(media(await renderResumeDocx(SAMPLE_BUILDER_RESUME, 'modern'))).toHaveLength(0);
  });

  it('встраиваются только JPEG и PNG', () => {
    expect(resumePhotoOf({ mime: 'image/png', bytes: JPEG })?.format).toBe('png');
    expect(resumePhotoOf({ mime: 'image/webp', bytes: JPEG })).toBeNull();
    expect(resumePhotoOf(null)).toBeNull();
  });
});
