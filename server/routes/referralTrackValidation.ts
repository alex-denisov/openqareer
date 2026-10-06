import { z } from 'zod';

/** Контакт третьего лица: только имя, роль и ссылка на публичный профиль. */
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120).nullable().optional(),
  profileUrl: z
    .string()
    .trim()
    .url()
    .max(300)
    .refine((value) => /^https:\/\//iu.test(value), 'Ссылка на профиль должна быть https')
    .nullable()
    .optional(),
});

/** Действие кандидата; статус «запрос отправлен» ставится только действием `candidate_sent_request`. */
export const putReferralTrackSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), contact: contactSchema }),
  z.object({ action: z.literal('draft_pitch'), pitch: z.string().trim().min(1).max(3_000) }),
  z.object({ action: z.literal('candidate_sent_request') }),
  z.object({ action: z.literal('record_reply'), outcome: z.enum(['positive', 'declined']) }),
  z.object({ action: z.literal('mark_no_reply') }),
]);

export type ReferralTrackInput = z.infer<typeof putReferralTrackSchema>;
