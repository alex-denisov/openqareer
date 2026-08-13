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

export const CAREER_ROLES = [
  'career_consultant',
  'career_strategist',
  'career_expert',
] as const;

export const CAREER_ACTION_KINDS = [
  'resume.draft',
  'resume.revise',
  'vacancies.search',
  'vacancies.local_query',
  'company.evaluate',
  'market.evaluate',
  'cover_letter.draft',
  'application.prepare',
  'application.submit',
  'outreach.prepare',
  'outreach.send',
  'connection.request',
] as const;

export const careerActionProposalSchema = z.object({
  kind: z.enum(CAREER_ACTION_KINDS),
  objective: z.string().trim().min(1).max(1_000),
  evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(100),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  expectedSignal: z.string().trim().min(1).max(1_000),
  measureAfter: z.string().date(),
  risk: z.enum(['read_only', 'candidate_data_write', 'external_side_effect']),
});

export const careerTrackSchema = z.object({
  objective: z.string().trim().min(1).max(1_000),
  alternatives: z.array(
    z.object({
      label: z.string().trim().min(1).max(300),
      reason: z.string().trim().min(1).max(1_000),
      evidenceRefs: z.array(z.string().min(1).max(80)).max(100),
      unknowns: z.array(z.string().trim().min(1).max(300)).max(20),
    }),
  ).min(1).max(3),
  milestones: z.array(
    z.object({
      label: z.string().trim().min(1).max(500),
      expectedSignal: z.string().trim().min(1).max(1_000),
      measureAfter: z.string().date(),
      successCriterion: z.string().trim().min(1).max(1_000),
    }),
  ).min(1).max(12),
});

export const coachMessageSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8_000),
});

export const marketObservationSchema = z.object({
  ref: z.string().regex(/^market:hh:[A-Za-z0-9_-]{1,128}$/u),
  source: z.literal('hh'),
  title: z.string().trim().min(1).max(500),
  company: z.string().trim().min(1).max(500),
  location: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().max(2_048),
  observedAt: z.string().datetime(),
});

export const knowledgeContextSchema = z.object({
  confirmedFacts: z
    .array(
      z.object({
        ref: z.string().regex(/^memory:[0-9a-f-]{36}$/u),
        kind: z.enum(MEMORY_KINDS),
        domain: z.enum(DOSSIER_DOMAINS),
        statement: z.string().trim().min(1).max(1_000),
        sourceRefs: z.array(z.string().min(1).max(80)).max(20),
        sensitive: z.boolean(),
      }),
    )
    .max(12),
  documents: z
    .array(
      z.object({
        ref: z.string().regex(/^document:[0-9a-f-]{36}$/u),
        kind: z.enum([
          'resume',
          'cover_letter',
          'certificate',
          'portfolio',
          'profile_export',
          'other',
        ]),
        fileName: z.string().trim().min(1).max(240),
        version: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        excerpt: z.string().trim().min(1).max(6_000),
      }),
    )
    .max(2),
  openQuestions: z
    .array(
      z.object({
        ref: z.string().regex(/^memory:[0-9a-f-]{36}$/u),
        statement: z.string().trim().min(1).max(1_000),
        sourceRefs: z.array(z.string().min(1).max(80)).max(20),
      }),
    )
    .max(12),
});

export const coachTurnInputSchema = z.object({
  candidateReference: z.string().min(8).max(80),
  dataClass: z.enum(['synthetic', 'personal']).default('personal'),
  locale: z.enum(['ru-RU', 'en-US']).default('ru-RU'),
  phase: z.enum(COACH_PHASES).default('discovery'),
  messages: z.array(coachMessageSchema).min(1).max(30),
  knowledgeContext: knowledgeContextSchema.optional(),
  marketObservations: z.array(marketObservationSchema).max(20).optional(),
  activeRole: z.enum(CAREER_ROLES).optional(),
  priorRoleContributions: z.array(
    z.object({
      role: z.enum(CAREER_ROLES),
      summary: z.string().trim().min(1).max(6_000),
      evidenceRefs: z.array(z.string().min(1).max(80)).max(100),
      unknowns: z.array(z.string().trim().min(1).max(300)).max(20),
    }),
  ).max(2).optional(),
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
  careerTrack: careerTrackSchema.nullable().default(null),
  actionProposals: z.array(careerActionProposalSchema).max(20).default([]),
  intelligence: z
    .object({
      orchestrationRevision: z.string().min(1).max(80),
      roleCoverage: z.array(
        z.enum([
          'career_consultant',
          'career_strategist',
          'career_expert',
        ]),
      ).min(1).max(3),
      roleContributions: z.array(
        z.object({
          role: z.enum([
            'career_consultant',
            'career_strategist',
            'career_expert',
          ]),
          summary: z.string().trim().min(1).max(6_000),
          evidenceRefs: z.array(z.string().min(1).max(80)).max(100),
          unknowns: z.array(z.string().trim().min(1).max(300)).max(20),
          provider: z.string().min(1).max(40),
          model: z.string().min(1).max(200),
          promptRevision: z.string().min(1).max(80),
          usage: z.object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            totalTokens: z.number().int().nonnegative(),
          }),
        }),
      ).min(1).max(3),
      evidenceCoverage: z.number().min(0).max(1),
      unsupportedClaimCount: z.number().int().nonnegative(),
      marketEvidence: z
        .object({
          source: z.literal('hh'),
          observationCount: z.number().int().positive().max(20),
          observedAt: z.string().datetime(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});

export type CoachTurnInput = z.infer<typeof coachTurnInputSchema>;
export type CoachTurnResult = z.infer<typeof coachTurnResultSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
export type CoachPhase = (typeof COACH_PHASES)[number];
export type CareerRole = (typeof CAREER_ROLES)[number];
export type CareerActionProposal = z.infer<typeof careerActionProposalSchema>;
export type CareerTrack = z.infer<typeof careerTrackSchema>;
export type MarketObservation = z.infer<typeof marketObservationSchema>;

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
    careerTrack: {
      anyOf: [
        {
          type: 'object',
          properties: {
            objective: { type: 'string', minLength: 1, maxLength: 1_000 },
            alternatives: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 300 },
                  reason: { type: 'string', minLength: 1, maxLength: 1_000 },
                  evidenceRefs: {
                    type: 'array',
                    maxItems: 100,
                    items: { type: 'string', minLength: 1, maxLength: 80 },
                  },
                  unknowns: {
                    type: 'array',
                    maxItems: 20,
                    items: { type: 'string', minLength: 1, maxLength: 300 },
                  },
                },
                required: ['label', 'reason', 'evidenceRefs', 'unknowns'],
                additionalProperties: false,
              },
            },
            milestones: {
              type: 'array',
              minItems: 1,
              maxItems: 12,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 500 },
                  expectedSignal: { type: 'string', minLength: 1, maxLength: 1_000 },
                  measureAfter: {
                    type: 'string',
                    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
                  },
                  successCriterion: { type: 'string', minLength: 1, maxLength: 1_000 },
                },
                required: ['label', 'expectedSignal', 'measureAfter', 'successCriterion'],
                additionalProperties: false,
              },
            },
          },
          required: ['objective', 'alternatives', 'milestones'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    actionProposals: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: CAREER_ACTION_KINDS },
          objective: { type: 'string', minLength: 1, maxLength: 1_000 },
          evidenceRefs: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          acceptanceCriteria: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 500 },
          },
          expectedSignal: { type: 'string', minLength: 1, maxLength: 1_000 },
          measureAfter: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          risk: {
            type: 'string',
            enum: ['read_only', 'candidate_data_write', 'external_side_effect'],
          },
        },
        required: [
          'kind',
          'objective',
          'evidenceRefs',
          'acceptanceCriteria',
          'expectedSignal',
          'measureAfter',
          'risk',
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    'message',
    'phase',
    'memoryCandidates',
    'nextQuestion',
    'completeness',
    'safety',
    'careerTrack',
    'actionProposals',
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
    activeRole: input.activeRole ?? 'career_consultant',
    priorRoleContributions: input.priorRoleContributions ?? [],
    marketObservations: input.marketObservations ?? [],
    knowledgeContext: input.knowledgeContext ?? {
      confirmedFacts: [],
      documents: [],
      openQuestions: [],
    },
    conversation: input.messages,
  });
}
