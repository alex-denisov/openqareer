import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  careerActionProposalSchema,
  type CareerActionProposal,
} from '../domain/coach';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';

export interface VerifiedCareerApproval {
  id: string;
  candidateId: string;
  commandId: string;
  capability: CareerActionProposal['kind'];
  expiresAt: string;
}

export type CareerCommandStatus =
  | 'awaiting_approval'
  | 'prepared'
  | 'queued'
  | 'executing'
  | 'completed_with_receipt'
  | 'paused'
  | 'failed'
  | 'native_handoff';

export interface CareerCommandRecord {
  schemaVersion: 'career-command-v1';
  commandId: string;
  candidateId: string;
  capability: CareerActionProposal['kind'];
  proposal: CareerActionProposal;
  status: CareerCommandStatus;
  provenance: {
    strategyDecisionId: string;
    evidenceRefs: string[];
    modelInvocationIds: string[];
  };
  authorization: { approvalId: string | null };
  idempotency: {
    key: string;
    payloadDigest: string;
    semantics: 'at_most_once';
  };
  execution: ConnectorActionRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface CareerCommandPlannerOptions {
  createId: () => string;
  now?: () => Date;
}

export class CareerCommandPolicyError extends Error {
  constructor(
    readonly code:
      | 'unknown_evidence'
      | 'invalid_approval'
      | 'invalid_capability_risk',
  ) {
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
  }): CareerCommandRecord {
    const proposal = validateProposal(input);
    const commandId = this.createId();

    const externalWrite = proposal.risk === 'external_side_effect';
    if (
      input.approval &&
      !approvalMatches(input, commandId, proposal, this.now())
    ) {
      throw new CareerCommandPolicyError('invalid_approval');
    }
    const approvalId = input.approval?.id ?? null;
    const status =
      externalWrite && !approvalId ? 'awaiting_approval' : 'prepared';
    const createdAt = this.now().toISOString();

    return {
      schemaVersion: 'career-command-v1' as const,
      commandId,
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
      execution: null,
      createdAt,
      updatedAt: createdAt,
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
  if (
    proposal.risk === 'external_side_effect' &&
    ![
      'application.submit',
      'outreach.send',
      'connection.request',
    ].includes(proposal.kind)
  ) {
    throw new CareerCommandPolicyError('invalid_capability_risk');
  }
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
  commandId: string,
  proposal: CareerActionProposal,
  now: Date,
): boolean {
  return Boolean(
    input.approval &&
      input.approval.candidateId === input.principal.candidateId &&
      input.approval.commandId === commandId &&
      input.approval.capability === proposal.kind &&
      Date.parse(input.approval.expiresAt) > now.getTime(),
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
