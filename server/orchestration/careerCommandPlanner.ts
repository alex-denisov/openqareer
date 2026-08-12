import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  careerActionProposalSchema,
  type CareerActionProposal,
} from '../domain/coach';

export interface VerifiedCareerApproval {
  id: string;
  candidateId: string;
  capability: CareerActionProposal['kind'];
  expiresAt: string;
}

export interface CareerCommandPlannerOptions {
  createId: () => string;
  now?: () => Date;
}

export class CareerCommandPolicyError extends Error {
  constructor(readonly code: 'unknown_evidence' | 'invalid_approval') {
    super(code);
    this.name = 'CareerCommandPolicyError';
  }
}

export class CareerCommandPlanner {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: CareerCommandPlannerOptions) {
    this.createId = options.createId;
    this.now = options.now ?? (() => new Date());
  }

  materialize(input: {
    principal: { candidateId: string };
    proposal: CareerActionProposal;
    availableEvidenceRefs: ReadonlySet<string>;
    strategyDecisionId: string;
    modelInvocationIds: string[];
    idempotencyKey: string;
    approval: VerifiedCareerApproval | null;
  }) {
    const proposal = validateProposal(input);

    const externalWrite = proposal.risk === 'external_side_effect';
    if (input.approval && !approvalMatches(input, proposal, this.now())) {
      throw new CareerCommandPolicyError('invalid_approval');
    }
    const approvalId = input.approval?.id ?? null;
    const status =
      externalWrite && !approvalId ? 'awaiting_approval' : 'prepared';
    const createdAt = this.now().toISOString();

    return {
      schemaVersion: 'career-command-v1' as const,
      commandId: this.createId(),
      candidateId: input.principal.candidateId,
      capability: proposal.kind,
      proposal,
      status,
      provenance: {
        strategyDecisionId: input.strategyDecisionId,
        evidenceRefs: proposal.evidenceRefs,
        modelInvocationIds: input.modelInvocationIds,
      },
      authorization: {
        approvalId,
      },
      idempotency: {
        key: input.idempotencyKey,
        payloadDigest: commandDigest(input, proposal),
        semantics: 'at_most_once' as const,
      },
      createdAt,
    };
  }
}

function validateProposal(input: {
  proposal: CareerActionProposal;
  availableEvidenceRefs: ReadonlySet<string>;
  idempotencyKey: string;
}): CareerActionProposal {
  const proposal = careerActionProposalSchema.parse(input.proposal);
  z.string().uuid().parse(input.idempotencyKey);
  if (!proposal.evidenceRefs.every((ref) => input.availableEvidenceRefs.has(ref))) {
    throw new CareerCommandPolicyError('unknown_evidence');
  }
  return proposal;
}

function commandDigest(
  input: {
    principal: { candidateId: string };
    strategyDecisionId: string;
  },
  proposal: CareerActionProposal,
): string {
  return digest({
    candidateId: input.principal.candidateId,
    proposal,
    strategyDecisionId: input.strategyDecisionId,
  });
}

function approvalMatches(
  input: {
    principal: { candidateId: string };
    approval: VerifiedCareerApproval | null;
  },
  proposal: CareerActionProposal,
  now: Date,
): boolean {
  return Boolean(
    input.approval &&
      input.approval.candidateId === input.principal.candidateId &&
      input.approval.capability === proposal.kind &&
      Date.parse(input.approval.expiresAt) > now.getTime(),
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
