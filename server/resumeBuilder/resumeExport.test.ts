import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { RESUME_TEMPLATES, SAMPLE_BUILDER_RESUME } from '../../shared/resumeBuilder/model';
import { renderResumeDocx } from './resumeDocx';
import { renderResumePdf } from './resumePdf';

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/gu) ?? []).length;
}

const PROFILE_RESUME = {
  ...SAMPLE_BUILDER_RESUME,
  link: 'linkedin.com/in/anna',
  about: 'Веду бэкенд 8 лет',
  languages: 'Русский (родной), Английский (C1)',
  extra: [{ title: 'Курсы', lines: ['Kafka, 2023'] }],
};

describe('resume builder files (B567)', () => {
  it.each(RESUME_TEMPLATES)('%s: a one-page PDF with embedded fonts', async (template) => {
    const pdf = await renderResumePdf(SAMPLE_BUILDER_RESUME, template);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/\/FontFile2/u);
  });

  it('keeps a long career within two pages', async () => {
    const job = SAMPLE_BUILDER_RESUME.jobs[0];
    const resume = {
      ...SAMPLE_BUILDER_RESUME,
      jobs: Array.from({ length: 6 }, () => ({
        ...job,
        bullets: [...job.bullets, ...job.bullets],
      })),
    };
    const pdf = await renderResumePdf(resume, 'strict');
    expect(pageCount(pdf)).toBeLessThanOrEqual(2);
  });

  it.each(RESUME_TEMPLATES)(
    '%s: a Word document with the resume text and no tables',
    async (template) => {
      const docx = await renderResumeDocx(SAMPLE_BUILDER_RESUME, template);
      const xml = strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml']);
      expect(xml).toContain('Северный терминал');
      expect(xml).toContain('03.2021 — сейчас');
      expect(xml).not.toContain('<w:tbl>');
    },
  );

  it.each(RESUME_TEMPLATES)(
    '%s: «О себе», языки и другие разделы доходят до DOCX (B785)',
    async (template) => {
      const docx = await renderResumeDocx(PROFILE_RESUME, template);
      const xml = strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml']);
      for (const text of [
        'Веду бэкенд 8 лет',
        'Английский (C1)',
        'Kafka, 2023',
        'linkedin.com/in/anna',
      ]) {
        expect(xml).toContain(text);
      }
    },
  );

  it.each(RESUME_TEMPLATES)('%s: «О себе» и языки читаются из PDF (B785)', async (template) => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await renderResumePdf(PROFILE_RESUME, template);
    const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    expect(text).toContain('Веду бэкенд 8 лет');
    expect(text).toContain('Английский (C1)');
    expect(text).toContain('Kafka, 2023');
  });

  it('leaves the summary out of the strict (Stanford) template only', async () => {
    const strict = strFromU8(
      unzipSync(new Uint8Array(await renderResumeDocx(SAMPLE_BUILDER_RESUME, 'strict')))[
        'word/document.xml'
      ],
    );
    const modern = strFromU8(
      unzipSync(new Uint8Array(await renderResumeDocx(SAMPLE_BUILDER_RESUME, 'modern')))[
        'word/document.xml'
      ],
    );
    expect(strict).not.toContain('ГЛАВНЫЕ РЕЗУЛЬТАТЫ');
    expect(modern).toContain('ГЛАВНЫЕ РЕЗУЛЬТАТЫ');
  });
});
