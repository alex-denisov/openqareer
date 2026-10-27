import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from 'docx';
import {
  compactBuilderResume,
  contactLine,
  jobPeriod,
  type BuilderResume,
  type ResumeTemplate,
} from '../../shared/resumeBuilder/model';
import { TEMPLATE_STYLES, type TemplateStyle } from './templateStyle';

/** DOCX sizes are half-points; page width A4 minus margins, in twips. */
const half = (points: number) => Math.round(points * 2);
const twips = (points: number) => Math.round(points * 20);
const A4_WIDTH_PT = 595.28;

function rightTab(style: TemplateStyle) {
  return [{ type: TabStopType.RIGHT, position: twips(A4_WIDTH_PT - style.margin * 2) }];
}

function headParagraphs(resume: BuilderResume, style: TemplateStyle): Paragraph[] {
  const alignment = style.centeredHead ? AlignmentType.CENTER : AlignmentType.LEFT;
  const rows = [
    new Paragraph({
      alignment,
      children: [
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

function bodyParagraphs(resume: BuilderResume, style: TemplateStyle): Paragraph[] {
  const rows: Paragraph[] = [];
  if (style.showResults && resume.results.length) {
    rows.push(
      heading('Главные результаты', style),
      ...resume.results.map((item) => bullet(item, style)),
    );
  }
  if (resume.jobs.length) {
    rows.push(heading('Опыт работы', style));
    for (const job of resume.jobs) {
      rows.push(
        splitLine(job.company || job.role, job.city, 'bold', style),
        splitLine(job.company ? job.role : '', jobPeriod(job), 'italic', style),
        ...job.bullets.map((item) => bullet(item, style)),
      );
    }
  }
  if (resume.education.length) {
    rows.push(heading('Образование', style));
    for (const item of resume.education) {
      rows.push(splitLine(item.school, item.year, 'bold', style));
      if (item.degree) rows.push(splitLine(item.degree, '', 'italic', style));
    }
  }
  if (resume.skills.trim()) {
    rows.push(
      heading('Навыки', style),
      new Paragraph({ children: [new TextRun({ text: resume.skills.trim() })] }),
    );
  }
  return rows;
}

/** An editable Word document: real paragraphs, bullets and tab stops, no tables. */
export function renderResumeDocx(input: BuilderResume, template: ResumeTemplate): Promise<Buffer> {
  const resume = compactBuilderResume(input);
  const style = TEMPLATE_STYLES[template];
  const document = new Document({
    creator: 'openqareer',
    title: resume.fullName ? `Резюме — ${resume.fullName}` : 'Резюме',
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
        children: [...headParagraphs(resume, style), ...bodyParagraphs(resume, style)],
      },
    ],
  });
  return Packer.toBuffer(document);
}
