import { z } from 'zod';

/** B796: запись, где стоит факт кандидата. */
export const factCorrectionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('memory'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('about') }).strict(),
  z.object({ kind: z.literal('headline') }).strict(),
  z.object({ kind: z.literal('project'), id: z.string().min(1).max(200) }).strict(),
]);
export type FactCorrectionTarget = z.infer<typeof factCorrectionTargetSchema>;

export const FACT_TEXT_MAX = 10_000;
const text = z.string().min(1).max(FACT_TEXT_MAX);

export const factCorrectionSchema = z
  .object({ target: factCorrectionTargetSchema, before: text, after: text })
  .strict();
export type FactCorrectionChange = z.infer<typeof factCorrectionSchema>;

export const factCorrectionRevertSchema = z
  .object({ changes: z.array(factCorrectionSchema).min(1).max(200) })
  .strict();

/** Правка, которую кандидат назвал в разговоре: карточка «Было / Станет». */
export interface FactCorrectionProposal extends FactCorrectionChange {
  readonly place: string;
}

/** Исправлено столько-то записей; черновики сообщений пересобраны и ждут нового одобрения. */
export interface FactCorrectionOutcome {
  readonly changes: readonly FactCorrectionChange[];
  readonly resetMessages: number;
  readonly droppedVariants: number;
}
