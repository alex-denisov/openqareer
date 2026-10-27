import PDFDocument from 'pdfkit';
import {
  compactBuilderResume,
  contactLine,
  jobPeriod,
  type BuilderResume,
  type ResumeTemplate,
} from '../../shared/resumeBuilder/model';
import { loadResumeFonts } from './resumeFonts';
import { TEMPLATE_STYLES, type TemplateStyle } from './templateStyle';

type Doc = InstanceType<typeof PDFDocument>;

const INK = '#111111';
const hex = (value: string) => `#${value}`;

function contentWidth(doc: Doc, style: TemplateStyle): number {
  return doc.page.width - style.margin * 2;
}

function head(doc: Doc, resume: BuilderResume, style: TemplateStyle): void {
  const align = style.centeredHead ? 'center' : 'left';
  const name = style.nameUpper ? resume.fullName.toUpperCase() : resume.fullName;
  doc.font('bold').fontSize(style.nameSize).fillColor(INK);
  doc.text(name || ' ', { align, characterSpacing: style.nameUpper ? 1 : 0 });
  if (style.showTitle && resume.title) {
    doc
      .font('bold')
      .fontSize(style.bodySize + 2)
      .fillColor(hex(style.accent));
    doc.text(resume.title, { align });
  }
  const contacts = contactLine(resume);
  if (contacts) {
    doc
      .font('regular')
      .fontSize(style.bodySize - 0.5)
      .fillColor(hex(style.muted));
    doc.moveDown(0.2).text(contacts, { align });
  }
}

function section(doc: Doc, title: string, style: TemplateStyle): void {
  doc.moveDown(style.sectionGap / style.bodySize);
  doc.font('bold').fontSize(style.sectionSize).fillColor(hex(style.accent));
  doc.text(style.sectionUpper ? title.toUpperCase() : title, {
    characterSpacing: style.sectionUpper ? 0.6 : 0,
  });
  if (style.sectionRule) {
    const y = doc.y + 1;
    doc
      .moveTo(style.margin, y)
      .lineTo(style.margin + contentWidth(doc, style), y)
      .lineWidth(0.8)
      .strokeColor(INK)
      .stroke();
    doc.y = y + 3;
  } else {
    doc.moveDown(0.15);
  }
}

/** A line with text on the left and, on the same baseline, text on the right. */
function split(doc: Doc, left: string, right: string, font: string, style: TemplateStyle): void {
  const width = contentWidth(doc, style);
  const top = doc.y;
  doc.font('regular').fontSize(style.bodySize);
  const rightWidth = right ? doc.widthOfString(right) + 4 : 0;
  doc
    .font(font)
    .fillColor(INK)
    .text(left, style.margin, top, { width: width - rightWidth });
  const after = doc.y;
  if (right) {
    doc.font('regular').fillColor(hex(style.muted));
    doc.text(right, style.margin, top, { width, align: 'right' });
  }
  doc.x = style.margin;
  doc.y = Math.max(after, doc.y);
}

function bullets(doc: Doc, items: readonly string[], style: TemplateStyle): void {
  doc.font('regular').fontSize(style.bodySize).fillColor(INK);
  for (const item of items) {
    doc.text(`•  ${item}`, style.margin + 8, doc.y, {
      width: contentWidth(doc, style) - 8,
      lineGap: style.lineGap,
      indent: -8,
    });
  }
  doc.x = style.margin;
}

function body(doc: Doc, resume: BuilderResume, style: TemplateStyle): void {
  if (style.showResults && resume.results.length) {
    section(doc, 'Главные результаты', style);
    bullets(doc, resume.results, style);
  }
  if (resume.jobs.length) {
    section(doc, 'Опыт работы', style);
    resume.jobs.forEach((job, index) => {
      if (index > 0) doc.moveDown(0.4);
      split(doc, job.company || job.role, job.city, 'bold', style);
      split(doc, job.company ? job.role : '', jobPeriod(job), 'italic', style);
      bullets(doc, job.bullets, style);
    });
  }
  if (resume.education.length) {
    section(doc, 'Образование', style);
    for (const item of resume.education) {
      split(doc, item.school, item.year, 'bold', style);
      if (item.degree) split(doc, item.degree, '', 'italic', style);
    }
  }
  if (resume.skills.trim()) {
    section(doc, 'Навыки', style);
    doc.font('regular').fontSize(style.bodySize).fillColor(INK);
    doc.text(resume.skills.trim(), { lineGap: style.lineGap });
  }
}

/** A real PDF with embedded Cyrillic fonts, A4, text selectable for ATS. */
export function renderResumePdf(input: BuilderResume, template: ResumeTemplate): Promise<Buffer> {
  const resume = compactBuilderResume(input);
  const style = TEMPLATE_STYLES[template];
  const fonts = loadResumeFonts(style.family);
  const doc = new PDFDocument({
    size: 'A4',
    margin: style.margin,
    // pdfkit takes a font buffer here (its typings say only a path); the default
    // Helvetica would read an AFM file that the bundled server does not carry.
    font: fonts.regular as unknown as string,
    lang: 'ru-RU',
    info: {
      Title: resume.fullName ? `Резюме — ${resume.fullName}` : 'Резюме',
      Creator: 'openqareer',
    },
  });
  doc.registerFont('regular', fonts.regular);
  doc.registerFont('bold', fonts.bold);
  doc.registerFont('italic', fonts.italic);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      head(doc, resume, style);
      body(doc, resume, style);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
