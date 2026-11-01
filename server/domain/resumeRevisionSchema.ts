import { z } from 'zod';
import {
  EXPERIENCE_REVISION_FIELDS,
  TEAM_SIZE_TEXT_PATTERN,
  type ExperienceRevisionField,
} from '../../shared/experienceRevisionField';
import {
  ALL_PROFILE_ITEM_FIELDS,
  PROFILE_ITEM_OPERATIONS,
  PROFILE_ITEM_SECTIONS,
} from '../../shared/profileItemRevision';
import { profileItemRevisionIssue } from './profileItemRevision';

export const resumeExperienceDateTextSchema = z.union([
  z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  z.string().date(),
]);

/** Dates are canonical ISO months or days; a team size is a whole number of people. */
export function experienceRevisionTextIsValid(
  field: ExperienceRevisionField,
  proposedText: string,
): boolean {
  return field === 'teamSize'
    ? TEAM_SIZE_TEXT_PATTERN.test(proposedText)
    : resumeExperienceDateTextSchema.safeParse(proposedText).success;
}

export const resumeRevisionProposalSchema = z
  .object({
    section: z.enum(['headline', 'about', 'experience', 'skills', ...PROFILE_ITEM_SECTIONS]),
    experienceId: z.string().min(1).max(80).nullable(),
    memoryId: z.string().min(1).max(80).nullable(),
    field: z.enum(EXPERIENCE_REVISION_FIELDS).nullable().optional(),
    // Item targets of list sections (01.11); optional so stored turns still parse.
    itemId: z.string().min(1).max(80).nullable().optional(),
    operation: z.enum(PROFILE_ITEM_OPERATIONS).nullable().optional(),
    itemField: z
      .enum(ALL_PROFILE_ITEM_FIELDS as [string, ...string[]])
      .nullable()
      .optional(),
    itemFields: z
      .array(
        z
          .object({
            field: z.enum(ALL_PROFILE_ITEM_FIELDS as [string, ...string[]]),
            text: z.string().trim().min(1).max(5_000),
          })
          .strict(),
      )
      .max(12)
      .nullable()
      .optional(),
    proposedText: z.string().trim().min(1).max(10_000),
  })
  .strict()
  .superRefine((target, context) => {
    const itemIssue = profileItemRevisionIssue(target);
    if (itemIssue) context.addIssue({ code: z.ZodIssueCode.custom, message: itemIssue });
    const keyed = target.section === 'experience' || target.section === 'skills';
    if (keyed && !target.experienceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'experience and skill revisions need an entry key',
      });
    }
    if (!keyed && target.experienceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only experience revisions have an entry id',
      });
    }
    if (target.section !== 'experience' && target.memoryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only experience revisions can target a fact',
      });
    }
    if (target.field && target.section !== 'experience') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only experience revisions can target a date field',
      });
    }
    if (target.field && target.memoryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'experience date revisions cannot target a bullet fact',
      });
    }
    if (target.field && !experienceRevisionTextIsValid(target.field, target.proposedText)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'experience date revisions need a canonical ISO month or date',
      });
    }
  });

/** The model's JSON schema for `resumeRevision`; nullable keys are all required. */
export const RESUME_REVISION_JSON_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['headline', 'about', 'experience', ...PROFILE_ITEM_SECTIONS],
        },
        experienceId: {
          anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }],
        },
        memoryId: {
          anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }],
        },
        field: {
          anyOf: [{ type: 'string', enum: [...EXPERIENCE_REVISION_FIELDS] }, { type: 'null' }],
        },
        itemId: {
          anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }],
        },
        operation: {
          anyOf: [{ type: 'string', enum: [...PROFILE_ITEM_OPERATIONS] }, { type: 'null' }],
        },
        itemField: {
          anyOf: [{ type: 'string', enum: [...ALL_PROFILE_ITEM_FIELDS] }, { type: 'null' }],
        },
        itemFields: {
          anyOf: [
            {
              type: 'array',
              maxItems: 12,
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: [...ALL_PROFILE_ITEM_FIELDS] },
                  text: { type: 'string', minLength: 1, maxLength: 5_000 },
                },
                required: ['field', 'text'],
                additionalProperties: false,
              },
            },
            { type: 'null' },
          ],
        },
        proposedText: { type: 'string', minLength: 1, maxLength: 10_000 },
      },
      required: [
        'section',
        'experienceId',
        'memoryId',
        'field',
        'itemId',
        'operation',
        'itemField',
        'itemFields',
        'proposedText',
      ],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
} as const;
