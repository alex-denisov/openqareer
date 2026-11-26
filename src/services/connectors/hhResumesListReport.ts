import { plainText } from './hhMarkup';
import { hhQaBlocks } from './hhResumeCards';
import { parseHhResumesList } from './hhResumeParser';

/**
 * B787: список резюме кандидата hh.ru для локальной диагностики (`hh-resumes-list.txt`):
 * число резюме и по каждому id, название, видимость и дату обновления, как их показывает hh.ru.
 * Это данные самого кандидата; файл не покидает его компьютер.
 */
export const HH_RESUMES_REPORT_MAX_LENGTH = 16_000;
const VISIBILITY = /(не видно никому|видно\s+[^.\n]{1,80})/iu;
const clean = (value: string) =>
  value
    .replace(/[\t\n\r]+/gu, ' ')
    .trim()
    .slice(0, 200);

function visibilityById(html: string): ReadonlyMap<string, string> {
  return new Map(
    hhQaBlocks(html, 'resume').flatMap((card) => {
      const id = /href=["']\/resume\/([A-Za-z0-9]+)\/?["']/u.exec(card)?.[1];
      const shown = VISIBILITY.exec(plainText(card))?.[1];
      return id ? [[id, shown ? clean(shown) : '-'] as const] : [];
    }),
  );
}

export function hhResumesListReport(html: string, now = new Date()): string {
  const resumes = parseHhResumesList(html, now);
  const visibility = visibilityById(html);
  const rows = resumes.map((resume) =>
    [
      resume.id,
      clean(resume.title),
      visibility.get(resume.id) ?? '-',
      clean(resume.updatedLabel ?? '-'),
    ].join('\t'),
  );
  return [
    `read ${now.toISOString()}`,
    `resumes ${resumes.length}`,
    'id\ttitle\tvisibility\tupdated',
    ...rows,
  ]
    .join('\n')
    .slice(0, HH_RESUMES_REPORT_MAX_LENGTH);
}
