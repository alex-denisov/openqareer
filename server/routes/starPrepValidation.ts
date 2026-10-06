import { z } from 'zod';

const STAR_FIELDS = ['situation', 'task', 'action', 'result'] as const;

/** Абзац ответа: текст кандидата и обязательная ссылка на факт-источник. */
const paragraphSchema = z.object({
  questionId: z.string().trim().min(1).max(120),
  field: z.enum(STAR_FIELDS),
  text: z.string().trim().min(1).max(2_000),
  sourceFactId: z.string().trim().min(1, 'У абзаца нет факта-источника').max(160),
});

export const putStarPrepSchema = z
  .object({
    paragraphs: z.array(paragraphSchema).max(200),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.paragraphs.forEach((paragraph, index) => {
      const key = `${paragraph.questionId}:${paragraph.field}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['paragraphs', index],
          message: 'Абзац этого поля уже есть в вопросе',
        });
      }
      seen.add(key);
    });
  });

export type StarPrepInput = z.infer<typeof putStarPrepSchema>;
export type StarPrepParagraph = StarPrepInput['paragraphs'][number];
