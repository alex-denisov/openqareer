import { z } from 'zod';
import {
  connectorReceiptSchema,
  type ConnectorAction,
  type ConnectorExecutor,
  type ConnectorReceipt,
  type ConnectorRequest,
} from '../connectorHarness';
import { hhApplicationExecutionTargetSchema } from '../../orchestration/careerCommandPlanner';

export const hhExecutionPayloadSchema = z
  .object({
    commandId: z.string().uuid(),
    capability: z.literal('application.submit'),
    approvalId: z.string().uuid(),
    executionTarget: hhApplicationExecutionTargetSchema,
  })
  .strict();

export type HhExecutionPayload = z.infer<typeof hhExecutionPayloadSchema>;

export interface HhCandidateSessionResolver {
  get(candidateId: string): ConnectorExecutor | null;
}

export interface HhConnectorOptions {
  now?: () => string;
  sessionResolver?: HhCandidateSessionResolver;
}

/**
 * hh.ru integration boundary.
 *
 * Public reads remain in the existing, bounded `hhVacancySearch` production
 * path. Applicant writes are delegated only to an already isolated,
 * candidate-scoped browser session: the current public OpenAPI does not expose
 * an applicant apply operation.
 * Session creation and encrypted lifecycle stay outside this class so neither
 * credentials nor storage state can enter a command payload or receipt.
 */
export class HhConnector implements ConnectorExecutor {
  readonly connectorId = 'hh-connector';
  readonly transport = 'browser_session' as const;
  private readonly now: () => string;
  private readonly sessionResolver: HhCandidateSessionResolver;

  constructor(options: HhConnectorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionResolver = options.sessionResolver ?? { get: () => null };
  }

  async execute(request: ConnectorRequest): Promise<ConnectorReceipt> {
    if (request.action !== 'application') {
      return this.failed(request, `unsupported_action_${request.action}`);
    }
    const scope = this.resolveCandidateSession(request);
    if ('receipt' in scope) return scope.receipt;

    let delegated: ConnectorReceipt;
    try {
      delegated = await scope.session.execute(request);
    } catch {
      return this.paused(
        request,
        'hh_session_failed',
        'unexpected',
        'browser-session-error',
      );
    }
    return this.verifyDelegatedReceipt(request, delegated);
  }

  /**
   * Fail-closed pre-flight: an approved hh.ru write needs a candidate scope, an
   * exact approved target that matches the opportunity, and an already isolated
   * session for that same candidate. Any gap stops before network access.
   */
  private resolveCandidateSession(
    request: ConnectorRequest,
  ): { session: ConnectorExecutor } | { receipt: ConnectorReceipt } {
    if (!request.candidateId) {
      return {
        receipt: this.paused(
          request,
          'hh_candidate_scope_required',
          'session_state',
          'candidate-scope-missing',
        ),
      };
    }
    const payload = hhExecutionPayloadSchema.safeParse(request.payload);
    if (!payload.success) {
      return {
        receipt: this.paused(
          request,
          'hh_target_invalid',
          'unexpected',
          'execution-target-invalid',
        ),
      };
    }
    if (
      request.opportunityId !==
      `hh:vacancy:${payload.data.executionTarget.vacancyId}`
    ) {
      return {
        receipt: this.paused(
          request,
          'hh_target_mismatch',
          'unexpected',
          'opportunity-target-mismatch',
        ),
      };
    }
    const session = this.sessionResolver.get(request.candidateId);
    if (!session) {
      return {
        receipt: this.paused(
          request,
          'hh_session_required',
          'session_state',
          'candidate-session-missing',
        ),
      };
    }
    return { session };
  }

  /** A receipt only counts when it answers this exact dispatch with evidence. */
  private verifyDelegatedReceipt(
    request: ConnectorRequest,
    delegated: ConnectorReceipt,
  ): ConnectorReceipt {
    const parsed = connectorReceiptSchema.safeParse(delegated);
    if (
      !parsed.success ||
      parsed.data.idempotencyKey !== request.idempotencyKey ||
      parsed.data.opportunityId !== request.opportunityId ||
      parsed.data.action !== request.action
    ) {
      return this.paused(
        request,
        'receipt_invalid',
        'unexpected',
        'browser-receipt-invalid',
      );
    }
    if (
      parsed.data.status === 'completed' &&
      parsed.data.evidence?.kind !== 'dom_confirmation'
    ) {
      return this.paused(
        request,
        'hh_confirmation_invalid',
        'confirmation_missing',
        'dom-confirmation-required',
      );
    }
    return {
      ...parsed.data,
      connectorId: this.connectorId,
      transport: this.transport,
    };
  }

  private paused(
    request: ConnectorRequest,
    reason: string,
    surfaceState:
      | 'challenge'
      | 'unexpected'
      | 'confirmation_missing'
      | 'session_state',
    surfaceFingerprint: string,
  ): ConnectorReceipt {
    return {
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action,
      status: 'paused',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: {
        reason,
        surfaceState,
        observedAt: this.now(),
        surfaceFingerprint,
      },
    };
  }

  private failed(request: ConnectorRequest, reason: string): ConnectorReceipt {
    return {
      connectorId: this.connectorId,
      transport: this.transport,
      action: request.action as ConnectorAction,
      status: 'failed',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: { reason, observedAt: this.now() },
    };
  }
}
