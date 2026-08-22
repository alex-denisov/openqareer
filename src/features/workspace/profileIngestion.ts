import { z } from 'zod';

const sourceSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/iu),
  platform: z.enum(['linkedin', 'hh', 'other']),
  accessPath: z.enum([
    'candidate_export',
    'official_api',
    'permitted_public_page',
    'test_account_browser',
  ]),
  capturedAt: z.iso.datetime(),
});

const positionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).optional(),
  startedOn: z.string().trim().max(100).optional(),
  finishedOn: z.string().trim().max(100).optional(),
  description: z.string().trim().max(20_000).optional(),
});

const educationSchema = z.object({
  school: z.string().trim().min(1).max(500),
  degree: z.string().trim().max(500).optional(),
  startedOn: z.string().trim().max(100).optional(),
  finishedOn: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(10_000).optional(),
});

const snapshotSchema = z.object({
  headline: z.string().trim().max(500).optional(),
  summary: z.string().trim().max(20_000).optional(),
  location: z.string().trim().max(500).optional(),
  positions: z.array(positionSchema).max(200),
  education: z.array(educationSchema).max(100),
  skills: z.array(z.string().trim().min(1).max(300)).max(1_000),
});

const availableImportSchema = z.object({
  state: z.literal('available'),
  source: sourceSchema,
  snapshot: snapshotSchema,
});

const unavailableImportSchema = z.object({
  state: z.literal('unavailable'),
  source: sourceSchema,
  reason: z.enum([
    'authwall',
    'rate_limited',
    'blocked',
    'not_found',
    'unsupported',
  ]),
});

export type ProfileImportInput =
  | z.input<typeof availableImportSchema>
  | z.input<typeof unavailableImportSchema>;

export type ProfileFactStatus =
  | 'proposed'
  | 'confirmed'
  | 'corrected'
  | 'rejected';

export interface ProfileFact {
  id: string;
  kind: 'headline' | 'summary' | 'location' | 'position' | 'education' | 'skill';
  statement: string;
  status: ProfileFactStatus;
  confidence: 'source-reported' | 'candidate-confirmed';
  userEdited: boolean;
  provenance: {
    sourceId: string | null;
    platform: 'linkedin' | 'hh' | 'other';
    accessPath: z.infer<typeof sourceSchema>['accessPath'];
    capturedAt: string;
    locator: string | null;
    rawSourceState: 'available' | 'deleted';
  };
}

const profileFactSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum([
    'headline',
    'summary',
    'location',
    'position',
    'education',
    'skill',
  ]),
  statement: z.string().min(1).max(20_000),
  status: z.enum(['proposed', 'confirmed', 'corrected', 'rejected']),
  confidence: z.enum(['source-reported', 'candidate-confirmed']),
  userEdited: z.boolean(),
  provenance: z.object({
    sourceId: z.string().min(1).max(200).nullable(),
    platform: z.enum(['linkedin', 'hh', 'other']),
    accessPath: z.enum([
      'candidate_export',
      'official_api',
      'permitted_public_page',
      'test_account_browser',
    ]),
    capturedAt: z.iso.datetime(),
    locator: z.string().min(1).max(500).nullable(),
    rawSourceState: z.enum(['available', 'deleted']),
  }),
});

export function isProfileFact(value: unknown): value is ProfileFact {
  return profileFactSchema.safeParse(value).success;
}

interface ProfileInstructionSignal {
  locator: string;
  kind: 'instruction_override' | 'system_prompt_reference';
}

export type ProfileIngestionResult =
  | {
      state: 'ready_for_confirmation';
      sourceId: string;
      facts: ProfileFact[];
      instructionSignals: ProfileInstructionSignal[];
    }
  | {
      state: 'source_unavailable';
      sourceId: string;
      reason: z.infer<typeof unavailableImportSchema>['reason'];
      facts: [];
      nextAction: 'request_candidate_export' | 'native_handoff';
    };

interface ProfileFactCandidate {
  kind: ProfileFact['kind'];
  statement: string | undefined;
  locator: string;
}

export function ingestProfileSnapshot(
  input: ProfileImportInput,
): ProfileIngestionResult {
  const unavailable = unavailableImportSchema.safeParse(input);
  if (unavailable.success) {
    return unavailableProfileResult(unavailable.data);
  }

  const available = availableImportSchema.parse(input);
  const { source, snapshot } = available;
  const facts = createProfileFacts(profileFactCandidates(snapshot), source);
  return {
    state: 'ready_for_confirmation',
    sourceId: source.sourceId,
    facts,
    instructionSignals: facts.flatMap(instructionSignalsForFact),
  };
}

function unavailableProfileResult(
  input: z.infer<typeof unavailableImportSchema>,
): ProfileIngestionResult {
  return {
    state: 'source_unavailable',
    sourceId: input.source.sourceId,
    reason: input.reason,
    facts: [],
    nextAction:
      input.source.accessPath === 'permitted_public_page'
        ? 'request_candidate_export'
        : 'native_handoff',
  };
}

function profileFactCandidates(
  snapshot: z.infer<typeof snapshotSchema>,
): ProfileFactCandidate[] {
  return [
    {
      kind: 'headline',
      statement: snapshot.headline,
      locator: 'profile.headline',
    },
    { kind: 'summary', statement: snapshot.summary, locator: 'profile.summary' },
    {
      kind: 'location',
      statement: snapshot.location,
      locator: 'profile.location',
    },
    ...snapshot.positions.map((position, index) => ({
      kind: 'position' as const,
      statement: formatPosition(position),
      locator: `positions[${index}]`,
    })),
    ...snapshot.education.map((education, index) => ({
      kind: 'education' as const,
      statement: formatEducation(education),
      locator: `education[${index}]`,
    })),
    ...snapshot.skills.map((skill, index) => ({
      kind: 'skill' as const,
      statement: skill,
      locator: `skills[${index}]`,
    })),
  ];
}

function createProfileFacts(
  candidates: ProfileFactCandidate[],
  source: z.infer<typeof sourceSchema>,
): ProfileFact[] {
  return candidates
    .filter(
      (candidate): candidate is typeof candidate & { statement: string } =>
        Boolean(candidate.statement?.trim()),
    )
    .map((candidate, index): ProfileFact => ({
      id: `${source.sourceId}-fact-${String(index + 1).padStart(3, '0')}`,
      kind: candidate.kind,
      statement: candidate.statement.trim(),
      status: 'proposed',
      confidence: 'source-reported',
      userEdited: false,
      provenance: {
        sourceId: source.sourceId,
        platform: source.platform,
        accessPath: source.accessPath,
        capturedAt: source.capturedAt,
        locator: candidate.locator,
        rawSourceState: 'available',
      },
    }));
}

export function reviewProfileFact(
  fact: ProfileFact,
  change: {
    status: Extract<ProfileFactStatus, 'confirmed' | 'corrected' | 'rejected'>;
    statement?: string;
  },
): ProfileFact {
  const requestedStatement = change.statement?.trim();
  if (change.status === 'corrected' && !change.statement?.trim()) {
    throw new Error('corrected_profile_fact_requires_statement');
  }
  if (
    change.status === 'confirmed' &&
    requestedStatement !== undefined &&
    requestedStatement !== fact.statement
  ) {
    throw new Error('profile_fact_edit_requires_corrected_status');
  }
  const statement =
    change.status === 'rejected'
      ? fact.statement
      : requestedStatement ?? fact.statement;
  if (change.status !== 'rejected' && statement.length < 2) {
    throw new Error('profile_fact_statement_too_short');
  }
  return {
    ...fact,
    statement,
    status: change.status,
    confidence:
      change.status === 'rejected' ? fact.confidence : 'candidate-confirmed',
    userEdited: fact.userEdited || statement !== fact.statement,
  };
}

export function deleteRawProfileSource(
  facts: ProfileFact[],
  sourceId: string,
): ProfileFact[] {
  return facts.flatMap((fact) => {
    if (fact.provenance.sourceId !== sourceId) return [fact];
    if (fact.status !== 'confirmed' && fact.status !== 'corrected') return [];
    return [
      {
        ...fact,
        provenance: {
          ...fact.provenance,
          sourceId: null,
          locator: null,
          rawSourceState: 'deleted' as const,
        },
      },
    ];
  });
}

function formatPosition(position: z.infer<typeof positionSchema>): string {
  const dates = [position.startedOn, position.finishedOn]
    .filter(Boolean)
    .join(' — ');
  return [
    `${position.title} · ${position.company}`,
    position.location,
    dates,
    position.description,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatEducation(education: z.infer<typeof educationSchema>): string {
  const dates = [education.startedOn, education.finishedOn]
    .filter(Boolean)
    .join(' — ');
  return [education.school, education.degree, dates, education.notes]
    .filter(Boolean)
    .join('\n');
}

function instructionSignalsForFact(
  fact: ProfileFact,
): ProfileInstructionSignal[] {
  const signals: ProfileInstructionSignal[] = [];
  if (
    /ignore\s+(all\s+)?previous\s+instructions?/iu.test(fact.statement) ||
    /игнорируй\s+(все\s+)?предыдущие\s+инструкции/iu.test(fact.statement)
  ) {
    signals.push({
      locator: fact.provenance.locator ?? 'deleted-source',
      kind: 'instruction_override',
    });
  }
  if (/system\s+prompt|системн(?:ый|ого)\s+промпт/iu.test(fact.statement)) {
    signals.push({
      locator: fact.provenance.locator ?? 'deleted-source',
      kind: 'system_prompt_reference',
    });
  }
  return signals;
}
