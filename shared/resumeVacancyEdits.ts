import { z } from 'zod';

/** B785, o03: правка резюме под вакансию — пункт поднят выше под требование вакансии. */
export interface ResumeVacancyEdit {
  readonly id: string;
  /** Текст в резюме: из профиля или изменённый кандидатом. */
  readonly text: string;
  /** Требование вакансии, под которое пункт поднят. */
  readonly why: string;
  /** Кандидат отменил правку: пункт стоит на прежнем месте с прежним текстом. */
  readonly cancelled: boolean;
}

export interface ResumeEditChoices {
  readonly cancelled: readonly string[];
  readonly texts: Readonly<Record<string, string>>;
}

export const NO_EDIT_CHOICES: ResumeEditChoices = { cancelled: [], texts: {} };
export const RESUME_EDIT_TEXT_MAX = 400;

export const resumeEditDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), id: z.string().min(1).max(400) }).strict(),
  z.object({ action: z.literal('restore'), id: z.string().min(1).max(400) }).strict(),
  z
    .object({
      action: z.literal('text'),
      id: z.string().min(1).max(400),
      text: z.string().trim().min(1).max(RESUME_EDIT_TEXT_MAX),
    })
    .strict(),
]);

export type ResumeEditDecision = z.infer<typeof resumeEditDecisionSchema>;
