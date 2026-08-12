import { createHash } from 'node:crypto';
import type { CoachTurnInput } from '../domain/coach';
import type {
  CoachProvider,
  CoachProviderResult,
  ProviderUsage,
} from '../providers/coachProvider';

export const CAREER_ORCHESTRATION_REVISION =
  'career-orchestration-v1.0-2026-08-12' as const;

export const CAREER_ROLES = [
  'career_consultant',
  'career_strategist',
  'career_expert',
] as const;

export type CareerRole = (typeof CAREER_ROLES)[number];

export interface CareerRoleRunInput {
  role: CareerRole;
  input: CoachTurnInput;
  priorContributions: ReadonlyArray<{
    role: CareerRole;
    summary: string;
    evidenceRefs: string[];
    unknowns: string[];
  }>;
  idempotencyKey: string;
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
  ): Promise<CoachProviderResult> {
    const roles = rolesFor(input);
    if (roles.length > this.maxModelCalls) {
      throw new CareerOrchestrationBudgetError();
    }
    const runs = await runRoles(
      this.roleAgent,
      roles,
      input,
      idempotencyKey,
    );
    return finalizeCareerTurn(input, roles, runs);
  }
}

type RoleRun = { role: CareerRole; output: CoachProviderResult };

async function runRoles(
  roleAgent: CareerRoleAgent,
  roles: CareerRole[],
  input: CoachTurnInput,
  idempotencyKey: string,
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
    });
    runs.push({ role, output });
  }
  return runs;
}

function finalizeCareerTurn(
  input: CoachTurnInput,
  roles: CareerRole[],
  runs: RoleRun[],
): CoachProviderResult {
  const final = runs.at(-1);
  if (!final) throw new Error('career orchestration produced no role output');
  const strategist = runs.find(({ role }) => role === 'career_strategist');
  const supportedMessageIds = new Set(
    input.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.id),
  );
  const claimRefs = runs.flatMap(({ output }) =>
    output.result.memoryCandidates.map((candidate) => candidate.sourceMessageIds),
  );
  const supportedClaims = claimRefs.filter(
    (refs) => refs.length > 0 && refs.every((ref) => supportedMessageIds.has(ref)),
  ).length;

  return {
    ...final.output,
    usage: sumUsage(runs.map(({ output }) => output.usage)),
    result: {
      ...final.output.result,
      careerTrack:
        strategist?.output.result.careerTrack ?? final.output.result.careerTrack,
      actionProposals: proposalsFrom(strategist, final).filter((proposal) =>
        proposal.evidenceRefs.every((ref) => supportedMessageIds.has(ref)),
      ),
      intelligence: intelligenceFrom(
        roles,
        runs,
        claimRefs,
        supportedClaims,
      ),
    },
  };
}

function proposalsFrom(strategist: RoleRun | undefined, final: RoleRun) {
  return strategist?.output.result.actionProposals ?? final.output.result.actionProposals;
}

function intelligenceFrom(
  roles: CareerRole[],
  runs: RoleRun[],
  claimRefs: string[][],
  supportedClaims: number,
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
    evidenceCoverage:
      claimRefs.length === 0 ? 1 : supportedClaims / claimRefs.length,
    unsupportedClaimCount: claimRefs.length - supportedClaims,
  };
}

function rolesFor(input: CoachTurnInput): CareerRole[] {
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
      new Set(
        output.result.memoryCandidates.flatMap(
          (candidate) => candidate.sourceMessageIds,
        ),
      ),
    ),
    unknowns: output.result.completeness.unknown,
  };
}

function promptRevision(role: CareerRole): string {
  return `${role}-v1.0-2026-08-12`;
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

function roleIdempotencyKey(key: string, role: CareerRole): string {
  const digest = createHash('sha256').update(`${key}:${role}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
