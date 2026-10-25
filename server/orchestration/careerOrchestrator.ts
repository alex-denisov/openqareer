import { createHash } from 'node:crypto';
import type { CoachTurnInput } from '../domain/coach';
import type {
  CoachProvider,
  CoachProviderResult,
  CoachTurnOptions,
  ProviderUsage,
} from '../providers/coachProvider';
import { CAREER_ROLE_PROMPT_REVISIONS } from '../prompts/careerRolePrompts';
import { faithfulMemoryCandidates } from './memoryCandidateGuard';

const CAREER_ORCHESTRATION_REVISION = 'career-orchestration-v1.0-2026-08-12' as const;

export type CareerRole = 'career_consultant' | 'career_strategist' | 'career_expert';

interface CareerRoleRunInput {
  role: CareerRole;
  input: CoachTurnInput;
  priorContributions: ReadonlyArray<{
    role: CareerRole;
    summary: string;
    evidenceRefs: string[];
    unknowns: string[];
  }>;
  idempotencyKey: string;
  options?: CoachTurnOptions;
}

export interface CareerRoleAgent {
  run(input: CareerRoleRunInput): Promise<CoachProviderResult>;
}

export interface CareerOrchestratorOptions {
  roleAgent: CareerRoleAgent;
  budget?: {
    maxModelCalls?: number;
  };
}

export class CareerOrchestrationBudgetError extends Error {
  readonly code = 'career_orchestration_budget_exceeded';

  constructor() {
    super('The configured model-call budget cannot cover the selected career route.');
    this.name = 'CareerOrchestrationBudgetError';
  }
}

export class CareerOrchestrator implements CoachProvider {
  private readonly roleAgent: CareerRoleAgent;
  private readonly maxModelCalls: number;

  constructor(options: CareerOrchestratorOptions) {
    this.roleAgent = options.roleAgent;
    this.maxModelCalls = options.budget?.maxModelCalls ?? 3;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult> {
    const roles = rolesFor(input);
    if (roles.length > this.maxModelCalls) {
      throw new CareerOrchestrationBudgetError();
    }
    const [runs, extracted] = await Promise.all([
      runRoles(this.roleAgent, roles, input, idempotencyKey, options),
      extractCandidateFacts(this.roleAgent, input, idempotencyKey),
    ]);
    return finalizeCareerTurn(input, roles, runs, extracted);
  }
}

type RoleRun = { role: CareerRole; output: CoachProviderResult };

/** Shorter answers are questions; the roles' own fact rule covers them. */
const FACT_STEP_MIN_CHARS = 300;

/**
 * The fact step runs beside the role chain, so it adds no wait; it reads only the candidate's
 * answer and has one job. A failed step costs the profile its facts, never the turn.
 */
async function extractCandidateFacts(
  roleAgent: CareerRoleAgent,
  input: CoachTurnInput,
  idempotencyKey: string,
): Promise<CoachProviderResult['result']['memoryCandidates']> {
  const latest = input.messages.at(-1);
  if (input.internalPurpose || latest?.role !== 'user') return [];
  if (latest.content.length < FACT_STEP_MIN_CHARS) return [];
  try {
    const output = await roleAgent.run({
      role: 'career_consultant',
      input: { ...input, internalPurpose: 'fact-extraction' },
      priorContributions: [],
      idempotencyKey: roleIdempotencyKey(idempotencyKey, 'fact-extraction'),
    });
    console.warn(
      JSON.stringify({
        event: 'coach-fact-step',
        facts: output.result.memoryCandidates.length,
        model: output.model,
      }),
    );
    return output.result.memoryCandidates;
  } catch (error) {
    logFactStepFailure(error);
    return [];
  }
}

/** The turn goes on without the facts; the journal still has to say why they are missing. */
function logFactStepFailure(error: unknown): void {
  const failure = error as { code?: string; attempts?: unknown; message?: string };
  console.warn(
    JSON.stringify({
      event: 'coach-fact-step-failed',
      code: failure.code ?? 'unknown',
      attempts: failure.attempts ?? null,
      message: failure.code ? undefined : String(failure.message ?? error).slice(0, 200),
    }),
  );
}

async function runRoles(
  roleAgent: CareerRoleAgent,
  roles: CareerRole[],
  input: CoachTurnInput,
  idempotencyKey: string,
  options?: CoachTurnOptions,
): Promise<RoleRun[]> {
  const runs: RoleRun[] = [];
  for (const role of roles) {
    const output = await roleAgent.run({
      role,
      input,
      priorContributions: runs.map(({ role: priorRole, output: priorOutput }) =>
        contribution(priorRole, priorOutput),
      ),
      idempotencyKey: roleIdempotencyKey(idempotencyKey, role),
      // Only the last role writes the answer the caller checks.
      ...(role === roles.at(-1) && options ? { options } : {}),
    });
    runs.push({ role, output });
  }
  return runs;
}

function finalizeCareerTurn(
  input: CoachTurnInput,
  roles: CareerRole[],
  runs: RoleRun[],
  extracted: CoachProviderResult['result']['memoryCandidates'] = [],
): CoachProviderResult {
  const final = runs.at(-1);
  if (!final) throw new Error('career orchestration produced no role output');
  const strategist = runs.find(({ role }) => role === 'career_strategist');
  const supportedEvidenceRefs = new Set(candidateEvidenceRefs(input));
  const supportedProposalRefs = new Set([
    ...supportedEvidenceRefs,
    ...(input.marketObservations?.map((observation) => observation.ref) ?? []),
  ]);
  const claimRefs = runs.flatMap(({ output }) =>
    output.result.memoryCandidates.map((candidate) => candidate.sourceMessageIds),
  );
  const supportedClaims = claimRefs.filter(
    (refs) => refs.length > 0 && refs.every((ref) => supportedProposalRefs.has(ref)),
  ).length;

  return {
    ...final.output,
    usage: sumUsage(runs.map(({ output }) => output.usage)),
    result: {
      ...final.output.result,
      // Every role reads the candidate's message; facts the expert found are not the
      // consultant's to drop (26.10: a detailed answer left the profile with no fact).
      memoryCandidates: faithfulMemoryCandidates(input, [
        ...extracted,
        ...runs.flatMap(({ output }) => output.result.memoryCandidates),
      ]),
      careerTrack: careerTrackFrom(input, strategist, final),
      actionProposals: proposalsFrom(strategist, final).filter((proposal) =>
        proposal.evidenceRefs.every((ref) => supportedProposalRefs.has(ref)),
      ),
      intelligence: intelligenceFrom(
        roles,
        runs,
        claimRefs,
        supportedClaims,
        input.marketObservations ?? [],
      ),
    },
  };
}

function careerTrackFrom(input: CoachTurnInput, strategist: RoleRun | undefined, final: RoleRun) {
  const track = strategist?.output.result.careerTrack ?? final.output.result.careerTrack;
  if (!track) return track;
  const marketRefs = new Set(input.marketObservations?.map((observation) => observation.ref) ?? []);
  const supportedRefs = new Set([...candidateEvidenceRefs(input), ...marketRefs]);
  const fullySupported = track.alternatives.every(
    (alternative) =>
      alternative.evidenceRefs.length > 0 &&
      alternative.evidenceRefs.every((ref) => supportedRefs.has(ref)),
  );
  if (!fullySupported) return null;
  if (input.phase !== 'market') return track;
  const citesMarket = track.alternatives.every((alternative) =>
    alternative.evidenceRefs.some((ref) => marketRefs.has(ref)),
  );
  return citesMarket ? track : null;
}

function candidateEvidenceRefs(input: CoachTurnInput): string[] {
  return [
    ...input.messages.filter((message) => message.role === 'user').map((message) => message.id),
    ...(input.knowledgeContext?.confirmedFacts.map((fact) => fact.ref) ?? []),
    ...(input.knowledgeContext?.documents.map((document) => document.ref) ?? []),
    ...(input.knowledgeContext?.openQuestions.map((question) => question.ref) ?? []),
  ];
}

function proposalsFrom(strategist: RoleRun | undefined, final: RoleRun) {
  return strategist?.output.result.actionProposals ?? final.output.result.actionProposals;
}

function intelligenceFrom(
  roles: CareerRole[],
  runs: RoleRun[],
  claimRefs: string[][],
  supportedClaims: number,
  marketObservations: NonNullable<CoachTurnInput['marketObservations']>,
) {
  return {
    orchestrationRevision: CAREER_ORCHESTRATION_REVISION,
    roleCoverage: roles,
    roleContributions: runs.map(({ role, output }) => ({
      ...contribution(role, output),
      provider: output.provider,
      model: output.model,
      promptRevision: promptRevision(role),
      usage: output.usage,
    })),
    evidenceCoverage: claimRefs.length === 0 ? 1 : supportedClaims / claimRefs.length,
    unsupportedClaimCount: claimRefs.length - supportedClaims,
    marketEvidence: marketEvidenceFrom(marketObservations),
  };
}

function marketEvidenceFrom(observations: NonNullable<CoachTurnInput['marketObservations']>) {
  if (!observations.length) return null;
  return {
    source: 'hh' as const,
    observationCount: observations.length,
    observedAt: observations.reduce(
      (latest, observation) => (observation.observedAt > latest ? observation.observedAt : latest),
      observations[0].observedAt,
    ),
  };
}

function rolesFor(input: CoachTurnInput): CareerRole[] {
  if (input.internalPurpose === 'consultant-summary') {
    return ['career_consultant'];
  }
  // A server step reads JSON from the one role it asked (B461 suggestions and grading). Three
  // roles in turn left the consultant's prose as message and tripled the wait (B564).
  if (input.internalPurpose === 'structured-stage') {
    return [input.activeRole ?? 'career_expert'];
  }
  if (input.phase === 'discovery' || input.phase === 'evidence') {
    return ['career_consultant'];
  }
  return ['career_expert', 'career_strategist', 'career_consultant'];
}

function contribution(role: CareerRole, output: CoachProviderResult) {
  return {
    role,
    summary: output.result.message,
    evidenceRefs: Array.from(
      new Set(output.result.memoryCandidates.flatMap((candidate) => candidate.sourceMessageIds)),
    ),
    unknowns: output.result.completeness.unknown,
  };
}

function promptRevision(role: CareerRole): string {
  return CAREER_ROLE_PROMPT_REVISIONS[role];
}

function sumUsage(usages: ProviderUsage[]): ProviderUsage {
  return usages.reduce(
    (total, current) => ({
      inputTokens: total.inputTokens + current.inputTokens,
      outputTokens: total.outputTokens + current.outputTokens,
      totalTokens: total.totalTokens + current.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function roleIdempotencyKey(key: string, role: CareerRole | 'fact-extraction'): string {
  const digest = createHash('sha256').update(`${key}:${role}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
