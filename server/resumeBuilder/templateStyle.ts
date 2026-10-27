import type { ResumeTemplate } from '../../shared/resumeBuilder/model';
import type { ResumeFontFamily } from './resumeFonts';

/**
 * One description of each template for both file formats, so the PDF and the
 * DOCX of the same template look alike. Sizes are in points.
 */
export interface TemplateStyle {
  readonly family: ResumeFontFamily;
  /** DOCX font names that Word, Pages and Google Docs all carry. */
  readonly docxFont: string;
  readonly nameSize: number;
  readonly nameUpper: boolean;
  readonly centeredHead: boolean;
  readonly showTitle: boolean;
  readonly showResults: boolean;
  readonly bodySize: number;
  readonly sectionSize: number;
  readonly sectionUpper: boolean;
  readonly sectionRule: boolean;
  /** Accent colour of the title line and section headings, hex without «#». */
  readonly accent: string;
  readonly muted: string;
  readonly sectionGap: number;
  readonly lineGap: number;
  readonly margin: number;
}

export const TEMPLATE_STYLES: Record<ResumeTemplate, TemplateStyle> = {
  // Stanford format: one column, serif, ruled sections, experience first.
  strict: {
    family: 'serif',
    docxFont: 'Times New Roman',
    nameSize: 17,
    nameUpper: true,
    centeredHead: true,
    showTitle: false,
    showResults: false,
    bodySize: 10.5,
    sectionSize: 10.5,
    sectionUpper: true,
    sectionRule: true,
    accent: '111111',
    muted: '333333',
    sectionGap: 12,
    lineGap: 1.5,
    margin: 54,
  },
  modern: {
    family: 'sans',
    docxFont: 'Arial',
    nameSize: 22,
    nameUpper: false,
    centeredHead: false,
    showTitle: true,
    showResults: true,
    bodySize: 10,
    sectionSize: 9.5,
    sectionUpper: true,
    sectionRule: false,
    accent: '2F5BD3',
    muted: '6B7280',
    sectionGap: 14,
    lineGap: 1.8,
    margin: 50,
  },
  compact: {
    family: 'sans',
    docxFont: 'Arial',
    nameSize: 16,
    nameUpper: false,
    centeredHead: false,
    showTitle: true,
    showResults: true,
    bodySize: 9,
    sectionSize: 10,
    sectionUpper: false,
    sectionRule: false,
    accent: '111111',
    muted: '6B7280',
    sectionGap: 8,
    lineGap: 0.6,
    margin: 36,
  },
};
