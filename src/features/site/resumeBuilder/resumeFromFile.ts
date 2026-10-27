import { extractTextDocument } from '../../workspace/documentText';
import { extractPdfResume } from '../../workspace/pdfResume';
import { parseResumeContent } from '../../workspace/resumeParser';
import type { ParsedResume } from '../../workspace/resumeParserTypes';
import {
  EMPTY_BUILDER_RESUME,
  EMPTY_EDUCATION,
  EMPTY_JOB,
  type BuilderResume,
} from '../../../../shared/resumeBuilder/model';

const MONTHS: Record<string, string> = {
  янв: '01',
  фев: '02',
  мар: '03',
  апр: '04',
  ма: '05',
  июн: '06',
  июл: '07',
  авг: '08',
  сен: '09',
  окт: '10',
  ноя: '11',
  дек: '12',
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** «2021-03», «03.2021», «март 2021», «Mar 2021» → «03.2021»; anything vaguer stays empty. */
export function monthYear(value?: string): string {
  const text = (value ?? '').trim().toLowerCase();
  const iso = /^((?:19|20)\d{2})-(\d{1,2})/u.exec(text);
  if (iso) return `${iso[2].padStart(2, '0')}.${iso[1]}`;
  const dotted = /^(\d{1,2})[./]((?:19|20)\d{2})$/u.exec(text);
  if (dotted) return `${dotted[1].padStart(2, '0')}.${dotted[2]}`;
  const named = /^([a-zа-яё]+)\.?\s+((?:19|20)\d{2})$/u.exec(text);
  if (named) {
    const key = Object.keys(MONTHS).find((prefix) => named[1].startsWith(prefix));
    if (key) return `${MONTHS[key]}.${named[2]}`;
  }
  return '';
}

function yearOf(value?: string): string {
  return /(19|20)\d{2}/u.exec(value ?? '')?.[0] ?? '';
}

/** What the browser read from the visitor's file, laid into the builder's fields. */
export function builderFromParsed(parsed: ParsedResume): BuilderResume {
  const jobs = parsed.experience.slice(0, 15).map((job) => ({
    ...EMPTY_JOB,
    company: job.employer,
    city: job.location ?? '',
    role: job.title,
    start: monthYear(job.startDate),
    end: job.current ? '' : monthYear(job.endDate),
    current: job.current,
    bullets: [...job.achievements, ...job.responsibilities].slice(0, 12),
  }));
  const education = parsed.education.slice(0, 6).map((item) => ({
    ...EMPTY_EDUCATION,
    school: item.institution,
    degree: item.qualification ?? '',
    year: yearOf(item.endDate ?? item.startDate),
  }));
  return {
    ...EMPTY_BUILDER_RESUME,
    fullName: parsed.fullName ?? '',
    title: parsed.targetRole ?? parsed.headline ?? '',
    city: parsed.contact.location ?? '',
    phone: parsed.contact.phone ?? '',
    email: parsed.contact.email ?? '',
    jobs: jobs.length ? jobs : EMPTY_BUILDER_RESUME.jobs,
    education: education.length ? education : EMPTY_BUILDER_RESUME.education,
    skills: parsed.skills.join(', '),
  };
}

/** PDF or DOCX, read entirely in the browser: the file never leaves the device. */
export async function readResumeFile(file: File): Promise<BuilderResume> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const text = isPdf ? (await extractPdfResume(file)).text : await extractTextDocument(file);
  return builderFromParsed(parseResumeContent(text));
}
