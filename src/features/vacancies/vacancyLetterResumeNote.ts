import type { ApprovedVacancyLetterResult } from './vacancyLetterApi';

export interface ResumeNoteInput {
  /** Есть ли у кандидата резюме, которое можно приложить (из черновика письма). */
  readonly resumeAvailable?: boolean;
  /** Результат одобрения письма, пока оно одобрено. */
  readonly approved?: ApprovedVacancyLetterResult | null;
}

function dayMonth(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1);
}

/**
 * Пояснение строки «Резюме под вакансию» говорит правду о состоянии (B601): после одобрения —
 * привязан ли снимок, до одобрения — будет ли что прикрепить. Состояние неизвестно — пояснения нет.
 */
export function resumeRowNote({ resumeAvailable, approved }: ResumeNoteInput): string | undefined {
  if (approved) {
    if (!approved.resume) return 'Резюме не прикреплено: в профиле нет резюме';
    const day = dayMonth(approved.resume.snapshotAt);
    // Текст макета 5 (mock-inv-5-390.md:78).
    return day ? 'Снимок от ' + day + ', мастер-резюме не менялось' : 'Снимок резюме прикреплён к отклику';
  }
  if (resumeAvailable === true) return 'Снимок резюме прикрепится при одобрении письма';
  if (resumeAvailable === false) return 'В профиле нет резюме: прикрепить нечего, хотя письмо обещает приложение';
  return undefined;
}
