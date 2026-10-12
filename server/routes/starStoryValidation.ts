import { z } from 'zod';

const fieldsSchema = z
  .object({
    situation: z.string().trim().max(4_000),
    task: z.string().trim().max(4_000),
    action: z.string().trim().max(4_000),
    result: z.string().trim().max(4_000),
  })
  .strict();

const sourceFactIdsSchema = z
  .array(z.string().trim().min(1).max(160))
  .max(10)
  .default([])
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'fact_source_duplicate' });
    }
  });

const storyFields = {
  title: z.string().trim().min(1).max(160),
  fields: fieldsSchema,
  sourceFactIds: sourceFactIdsSchema,
};

function requireStoryContent(
  story: { fields: z.infer<typeof fieldsSchema> },
  context: z.RefinementCtx,
): void {
  if (Object.values(story.fields).every((value) => value.length === 0)) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'star_story_content_required' });
  }
}

export const starStoryWriteSchema = z.object(storyFields).strict().superRefine(requireStoryContent);

export const updateStarStorySchema = z
  .object({ expectedVersion: z.number().int().positive(), ...storyFields })
  .strict()
  .superRefine(requireStoryContent);

export const starStoryIdSchema = z.string().trim().min(1).max(160);
