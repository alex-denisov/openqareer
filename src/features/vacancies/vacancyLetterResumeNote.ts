import type { ApprovedVacancyLetterResult, LetterGeneralResume } from './vacancyLetterApi';
import type { LetterScreenState } from './vacancyLetterController';

export type LetterResumeKind = 'targeted' | 'master';

/** Снимок резюме не создался при одобрении (ошибка платформы): письмо не одобряется, пока его нет. */
export interface ResumeSnapshotFailure {
  /** Повтор «Подготовить резюме» уже не удался. */
  readonly retried: boolean;
  /** Готовое общее резюме кандидата, которое можно приложить вместо снимка. */
  readonly generalResume: LetterGeneralResume | null;
}

export interface ResumeRowInput {
  /** Есть ли опыт работы, то есть резюме для приложения (из черновика письма или кругов связей). */
  readonly resumeAvailable?: boolean;
  /** Под вакансию (Basic и выше) или общее резюме (Free). */
  readonly resumeKind?: LetterResumeKind;
  /** Результат одобрения письма, пока оно одобрено. */
  readonly approved?: ApprovedVacancyLetterResult | null;
  readonly failure?: ResumeSnapshotFailure | null;
}

export interface ResumeRowView {
  readonly title: string;
  readonly note?: string;
  /** Кнопка в строке: повторить снимок или приложить готовое общее резюме. */
  readonly action?: 'prepare' | 'attach-general';
}

const NO_EXPERIENCE =
  'В профиле нет опыта работы: отклик уйдёт без резюме, письмо об этом не упоминает';
const SNAPSHOT_FAILED = 'Не удалось подготовить резюме. Подготовьте его, чтобы одобрить письмо';

function dayMonth(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1);
}

function titleFor(kind: LetterResumeKind | 'general' | undefined): string {
  return kind === 'targeted' || kind === undefined ? 'Резюме под вакансию' : 'Резюме';
}

function failureRow(
  kind: LetterResumeKind | undefined,
  failure: ResumeSnapshotFailure,
): ResumeRowView {
  const title = titleFor(kind);
  if (failure.retried && failure.generalResume) {
    return {
      title,
      note:
        'Не удалось подготовить резюме. Можно приложить ваше общее резюме „' +
        failure.generalResume.fileName +
        '“',
      action: 'attach-general',
    };
  }
  return { title, note: SNAPSHOT_FAILED, action: 'prepare' };
}

function approvedRow(
  kind: LetterResumeKind | undefined,
  approved: ApprovedVacancyLetterResult,
): ResumeRowView {
  const resume = approved.resume;
  if (!resume) return { title: titleFor(kind), note: NO_EXPERIENCE };
  const day = dayMonth(resume.snapshotAt);
  if (resume.kind === 'targeted') {
    // Текст макета 5 (mock-inv-5-390.md:78).
    return {
      title: titleFor('targeted'),
      note: day ? 'Снимок от ' + day + ', мастер-резюме не менялось' : undefined,
    };
  }
  return {
    title: titleFor(resume.kind),
    note: day ? 'Общее резюме, снимок от ' + day : 'Общее резюме',
  };
}

/**
 * Строка «Резюме под вакансию» говорит правду о состоянии (B601, решения владельца 08.11): после
 * одобрения — что привязано, до одобрения — что прикрепится, без опыта — что резюме не будет, при
 * сбое снимка — что письмо не одобрится, пока резюме не готово. Состояние неизвестно — без пояснения.
 */
export function resumeRowView({
  resumeAvailable,
  resumeKind,
  approved,
  failure,
}: ResumeRowInput): ResumeRowView {
  if (failure) return failureRow(resumeKind, failure);
  if (approved) return approvedRow(resumeKind, approved);
  if (resumeAvailable === false) return { title: titleFor(resumeKind), note: NO_EXPERIENCE };
  if (resumeAvailable === true) {
    return resumeKind === 'master'
      ? { title: titleFor('master'), note: 'Общее резюме прикрепится при одобрении письма' }
      : {
          title: titleFor('targeted'),
          note: 'Резюме под вакансию прикрепится при одобрении письма',
        };
  }
  return { title: titleFor(resumeKind) };
}

/** Строка резюме по состоянию экрана письма: черновик, круги связей, одобрение и сбой снимка. */
export function resumeRowForLetter(state: LetterScreenState): ResumeRowView {
  return resumeRowView({
    resumeAvailable: state.draft.pitch?.resumeAvailable ?? state.circles.data?.resume?.available,
    resumeKind: state.draft.pitch?.resumeKind ?? state.circles.data?.resume?.kind,
    approved: state.approval.saved,
    failure: state.approval.resumeFailure,
  });
}
