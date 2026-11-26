import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from 'docx';
import {
  compactBuilderResume,
  contactLine,
  jobPeriod,
  resumeHeadings,
  tailSections,
  type BuilderResume,
  type ResumeTemplate,
} from '../../shared/resumeBuilder/model';
import { RESUME_PHOTO_GAP_PT, RESUME_PHOTO_PT, type ResumePhoto } from './resumePhoto';
import { TEMPLATE_STYLES, type TemplateStyle } from './templateStyle';

/** 1 pt = 12 700 EMU; the gap between the photo and the head text. */
const PHOTO_GAP_EMU = RESUME_PHOTO_GAP_PT * 12_700;
/** 72 pt in pixels at 96 dpi: docx sizes a picture in pixels. */
const PHOTO_PX = Math.round((RESUME_PHOTO_PT * 96) / 72);

/** Фото справа вверху, обтекание текстом шапки. */
function photoRun(photo: ResumePhoto): ImageRun {
  return new ImageRun({
    type: photo.format,
    data: photo.bytes,
    transformation: { width: PHOTO_PX, height: PHOTO_PX },
    altText: { name: 'photo', title: 'Фото', description: 'Фото' },
    floating: {
      horizontalPosition: { relative: 'margin', align: 'right' },
      verticalPosition: { relative: 'paragraph', offset: 0 },
      wrap: { type: 1, side: 'left' },
      margins: { left: PHOTO_GAP_EMU },
    },
  });
}

/** DOCX sizes are half-points; page width A4 minus margins, in twips. */
const half = (points: number) => Math.round(points * 2);
const twips = (points: number) => Math.round(points * 20);
const A4_WIDTH_PT = 595.28;

function rightTab(style: TemplateStyle) {
  return [{ type: TabStopType.RIGHT, position: twips(A4_WIDTH_PT - style.margin * 2) }];
}

function headParagraphs(
  resume: BuilderResume,
  style: TemplateStyle,
  photo: ResumePhoto | null,
): Paragraph[] {
  const alignment = style.centeredHead ? AlignmentType.CENTER : AlignmentType.LEFT;
  const rows = [
    new Paragraph({
      alignment,
      children: [
        ...(photo ? [photoRun(photo)] : []),
        new TextRun({
          text: style.nameUpper ? resume.fullName.toUpperCase() : resume.fullName,
          bold: true,
          size: half(style.nameSize),
          characterSpacing: style.nameUpper ? 20 : 0,
        }),
      ],
    }),
  ];
  if (style.showTitle && resume.title) {
    rows.push(
      new Paragraph({
        alignment,
        children: [
          new TextRun({
            text: resume.title,
            bold: true,
            color: style.accent,
            size: half(style.bodySize + 2),
          }),
        ],
      }),
    );
  }
  const contacts = contactLine(resume);
  if (contacts) {
    rows.push(
      new Paragraph({
        alignment,
        children: [
          new TextRun({ text: contacts, color: style.muted, size: half(style.bodySize - 0.5) }),
        ],
      }),
    );
  }
  return rows;
}

function heading(title: string, style: TemplateStyle): Paragraph {
  return new Paragraph({
    spacing: { before: twips(style.sectionGap), after: twips(3) },
    keepNext: true,
    border: style.sectionRule
      ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: '111111', space: 1 } }
      : undefined,
    children: [
      new TextRun({
        text: style.sectionUpper ? title.toUpperCase() : title,
        bold: true,
        color: style.accent,
        size: half(style.sectionSize),
      }),
    ],
  });
}

function splitLine(
  left: string,
  right: string,
  kind: 'bold' | 'italic',
  style: TemplateStyle,
): Paragraph {
  const children = [new TextRun({ text: left, bold: kind === 'bold', italics: kind === 'italic' })];
  if (right) children.push(new TextRun({ text: `\t${right}`, color: style.muted }));
  return new Paragraph({ tabStops: rightTab(style), keepNext: true, children });
}

function bullet(text: string, style: TemplateStyle): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: twips(style.lineGap) },
    children: [new TextRun({ text })],
  });
}

function plain(lines: readonly string[]): Paragraph[] {
  return lines.map((text) => new Paragraph({ children: [new TextRun({ text })] }));
}

function bodyParagraphs(resume: BuilderResume, style: TemplateStyle): Paragraph[] {
  const titles = resumeHeadings(resume);
  const rows: Paragraph[] = [];
  if (resume.about?.trim()) {
    rows.push(heading(titles.about, style), ...plain(resume.about.trim().split('\n')));
  }
  if (style.showResults && resume.results.length) {
    rows.push(heading(titles.results, style), ...resume.results.map((item) => bullet(item, style)));
  }
  if (resume.jobs.length) {
    rows.push(heading(titles.jobs, style));
    for (const job of resume.jobs) {
      rows.push(
        splitLine(job.company || job.role, job.city, 'bold', style),
        splitLine(job.company ? job.role : '', jobPeriod(job, resume.lang), 'italic', style),
        ...job.bullets.map((item) => bullet(item, style)),
      );
    }
  }
  if (resume.education.length) {
    rows.push(heading(titles.education, style));
    for (const item of resume.education) {
      rows.push(splitLine(item.school, item.year, 'bold', style));
      if (item.degree) rows.push(splitLine(item.degree, '', 'italic', style));
    }
  }
  for (const item of tailSections(resume)) {
    rows.push(heading(item.title, style), ...plain(item.lines));
  }
  return rows;
}

/** An editable Word document: real paragraphs, bullets and tab stops, no tables. */
export function renderResumeDocx(
  input: BuilderResume,
  template: ResumeTemplate,
  photo: ResumePhoto | null = null,
): Promise<Buffer> {
  const resume = compactBuilderResume(input);
  const style = TEMPLATE_STYLES[template];
  const document = new Document({
    creator: 'openqareer',
    title: resume.fullName
      ? `${resumeHeadings(resume).file} — ${resume.fullName}`
      : resumeHeadings(resume).file,
    styles: {
      default: { document: { run: { font: style.docxFont, size: half(style.bodySize) } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(A4_WIDTH_PT), height: twips(841.89) },
            margin: {
              top: twips(style.margin),
              bottom: twips(style.margin),
              left: twips(style.margin),
              right: twips(style.margin),
            },
          },
        },
        children: [...headParagraphs(resume, style, photo), ...bodyParagraphs(resume, style)],
      },
    ],
  });
  return Packer.toBuffer(document);
}
