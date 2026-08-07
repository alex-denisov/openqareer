import { z } from 'zod';
import { CAREER_SUPER_PROMPT } from '../prompts/careerSuperPrompt';

export const COACH_PHASES = [
  'discovery',
  'evidence',
  'role',
  'market',
  'resume',
  'targeting',
] as const;

export const MEMORY_KINDS = [
  'fact',
  'preference',
  'hypothesis',
  'open-question',
] as const;

export const MEMORY_CONFIDENCE = [
  'candidate-confirmed',
  'candidate-reported',
  'coach-hypothesis',
] as const;

export const DOSSIER_DOMAINS = [
  'responsibility',
  'outcome',
  'skill',
  'preference',
  'constraint',
  'gap',
  'role-evidence',
  'other',
] as const;

export const coachMessageSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8_000),
});

export const coachTurnInputSchema = z.object({
  candidateReference: z.string().min(8).max(80),
  dataClass: z.enum(['synthetic', 'personal']).default('personal'),
  locale: z.enum(['ru-RU', 'en-US']).default('ru-RU'),
  phase: z.enum(COACH_PHASES).default('discovery'),
  messages: z.array(coachMessageSchema).min(1).max(30),
});

export const memoryCandidateSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  domain: z.enum(DOSSIER_DOMAINS).default('other'),
  statement: z.string().trim().min(1).max(1_000),
  confidence: z.enum(MEMORY_CONFIDENCE),
  sourceMessageIds: z.array(z.string().min(1).max(80)).max(20),
  sensitive: z.boolean(),
});

export const coachTurnResultSchema = z.object({
  message: z.string().trim().min(1).max(6_000),
  phase: z.enum(COACH_PHASES),
  memoryCandidates: z.array(memoryCandidateSchema).max(20),
  nextQuestion: z.string().trim().min(1).max(1_000).nullable(),
  completeness: z.object({
    known: z.array(z.string().trim().min(1).max(300)).max(20),
    unknown: z.array(z.string().trim().min(1).max(300)).max(20),
  }),
  safety: z.object({
    needsHuman: z.boolean(),
    reason: z.string().trim().min(1).max(500).nullable(),
  }),
});

export type CoachTurnInput = z.infer<typeof coachTurnInputSchema>;
export type CoachTurnResult = z.infer<typeof coachTurnResultSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
export type CoachPhase = (typeof COACH_PHASES)[number];

export const COACH_TURN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 6_000 },
    phase: { type: 'string', enum: COACH_PHASES },
    memoryCandidates: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: MEMORY_KINDS },
          domain: { type: 'string', enum: DOSSIER_DOMAINS },
          statement: { type: 'string', minLength: 1, maxLength: 1_000 },
          confidence: { type: 'string', enum: MEMORY_CONFIDENCE },
          sourceMessageIds: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          sensitive: { type: 'boolean' },
        },
        required: [
          'kind',
          'domain',
          'statement',
          'confidence',
          'sourceMessageIds',
          'sensitive',
        ],
        additionalProperties: false,
      },
    },
    nextQuestion: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 1_000 },
        { type: 'null' },
      ],
    },
    completeness: {
      type: 'object',
      properties: {
        known: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
        unknown: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
      required: ['known', 'unknown'],
      additionalProperties: false,
    },
    safety: {
      type: 'object',
      properties: {
        needsHuman: { type: 'boolean' },
        reason: {
          anyOf: [
            { type: 'string', minLength: 1, maxLength: 500 },
            { type: 'null' },
          ],
        },
      },
      required: ['needsHuman', 'reason'],
      additionalProperties: false,
    },
  },
  required: [
    'message',
    'phase',
    'memoryCandidates',
    'nextQuestion',
    'completeness',
    'safety',
  ],
  additionalProperties: false,
} as const;

export const CAREER_COACH_INSTRUCTIONS = CAREER_SUPER_PROMPT;

export function serializeCoachInput(input: CoachTurnInput): string {
  return JSON.stringify({
    task: 'Continue the candidate discovery interview',
    outputContract: COACH_TURN_JSON_SCHEMA,
    dataClass: input.dataClass,
    locale: input.locale,
    phase: input.phase,
    conversation: input.messages,
  });
}
