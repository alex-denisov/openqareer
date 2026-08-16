import { z } from 'zod';

export const connectorActionSchema = z.enum([
  'application',
  'message',
  'connection',
  'referral_request',
]);

export type ConnectorAction = z.infer<typeof connectorActionSchema>;
export const connectorTransportSchema = z.enum([
  'official_api',
  'public_feed',
  'public_http_parser',
  'browser_session',
  'native_handoff',
]);
export type ConnectorTransport = z.infer<typeof connectorTransportSchema>;

const safeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const connectorRequestSchema = z.object({
  candidateId: safeIdSchema.max(128).optional(),
  idempotencyKey: z.string().uuid(),
  opportunityId: safeIdSchema.max(128),
  action: connectorActionSchema,
  payload: z.unknown(),
});

export type ConnectorRequest = z.infer<typeof connectorRequestSchema>;

export const connectorDiagnosticSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    surfaceState: z
      .enum(['challenge', 'unexpected', 'confirmation_missing', 'session_state'])
      .optional(),
    observedAt: z.string().datetime().optional(),
    surfaceFingerprint: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
  })
  .strict();

export type ConnectorDiagnostic = z.infer<typeof connectorDiagnosticSchema>;

export const connectorReceiptSchema = z
  .object({
    connectorId: safeIdSchema.max(128),
    transport: connectorTransportSchema,
    action: connectorActionSchema,
    status: z.enum(['completed', 'paused', 'native_handoff', 'failed']),
    idempotencyKey: z.string().uuid(),
    opportunityId: safeIdSchema.max(128),
    providerReference: safeIdSchema.optional(),
    evidence: z
      .object({
        kind: z.enum([
          'provider_receipt',
          'dom_confirmation',
          'candidate_confirmation',
        ]),
        observedAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    diagnostic: connectorDiagnosticSchema.optional(),
  })
  .strict();

export type ConnectorReceipt = z.infer<typeof connectorReceiptSchema>;

export interface ConnectorExecutor {
  readonly connectorId?: string;
  readonly transport?: ConnectorTransport;
  execute(request: ConnectorRequest): Promise<ConnectorReceipt>;
}

interface HarnessOptions {
  executor: ConnectorExecutor;
  maxActions: number;
  observedAt?: () => string;
}

interface CachedReceipt {
  action: ConnectorAction;
  opportunityId: string;
  receipt: ConnectorReceipt;
}

export class ConnectorHarness {
  private readonly receipts = new Map<string, CachedReceipt>();
  private readonly completedTargetActions = new Set<string>();
  private readonly executor: ConnectorExecutor;
  private readonly maxActions: number;
  private readonly observedAt: () => string;
  private actionsUsed = 0;
  private pauseReason: string | null = null;

  constructor(options: HarnessOptions) {
    if (!Number.isInteger(options.maxActions) || options.maxActions < 1) {
      throw new Error('connector_action_budget_invalid');
    }
    this.executor = options.executor;
    this.maxActions = options.maxActions;
    this.observedAt = options.observedAt ?? (() => new Date().toISOString());
  }

  async execute(input: ConnectorRequest): Promise<ConnectorReceipt> {
    const request = connectorRequestSchema.parse(input);
    const cached = this.receipts.get(request.idempotencyKey);
    if (cached) {
      if (
        cached.action !== request.action ||
        cached.opportunityId !== request.opportunityId
      ) {
        this.pauseReason = 'idempotency_conflict';
        return this.pausedReceipt(request, 'idempotency_conflict');
      }
      return cached.receipt;
    }
    if (this.pauseReason) {
      return this.pausedReceipt(request, this.pauseReason);
    }
    if (this.actionsUsed >= this.maxActions) {
      return this.pausedReceipt(request, 'action_budget_exhausted');
    }
    const targetAction = `${request.opportunityId}:${request.action}`;
    if (
      request.action === 'application' &&
      this.completedTargetActions.has(targetAction)
    ) {
      return this.pausedReceipt(request, 'duplicate_target_action');
    }

    this.actionsUsed += 1;
    let receipt: ConnectorReceipt;
    try {
      const receiptResult = connectorReceiptSchema.safeParse(
        await this.executor.execute(request),
      );
      receipt = receiptResult.success
        ? receiptResult.data
        : this.pausedReceipt(request, 'receipt_invalid', {
            surfaceState: 'unexpected',
            surfaceFingerprint: 'receipt-schema-invalid',
          });
    } catch {
      receipt = this.pausedReceipt(request, 'unexpected_surface', {
        surfaceState: 'unexpected',
        surfaceFingerprint: 'executor-error',
      });
    }
    if (!receiptMatchesRequest(receipt, request)) {
      receipt = this.pausedReceipt(request, 'receipt_invalid', {
        surfaceState: 'unexpected',
        surfaceFingerprint: 'receipt-envelope-mismatch',
      });
    }
    this.receipts.set(request.idempotencyKey, {
      action: request.action,
      opportunityId: request.opportunityId,
      receipt,
    });
    if (receipt.status === 'paused') {
      this.pauseReason = receipt.diagnostic?.reason ?? 'connector_paused';
    } else if (receipt.status === 'completed') {
      this.completedTargetActions.add(targetAction);
    }
    return receipt;
  }

  pause(reason = 'owner_kill_switch'): void {
    this.pauseReason = reason;
  }

  resume(): void {
    this.pauseReason = null;
  }

  state(): {
    status: 'active' | 'paused';
    reason: string | null;
    actionsUsed: number;
    maxActions: number;
  } {
    return {
      status: this.pauseReason ? 'paused' : 'active',
      reason: this.pauseReason,
      actionsUsed: this.actionsUsed,
      maxActions: this.maxActions,
    };
  }

  private pausedReceipt(
    request: ConnectorRequest,
    reason: string,
    diagnostic: Omit<ConnectorDiagnostic, 'reason' | 'observedAt'> = {},
  ): ConnectorReceipt {
    return {
      connectorId: this.executor.connectorId ?? 'connector-harness',
      transport: this.executor.transport ?? 'native_handoff',
      action: request.action,
      status: 'paused',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: {
        reason,
        observedAt: this.observedAt(),
        ...diagnostic,
      },
    };
  }
}

function receiptMatchesRequest(
  receipt: ConnectorReceipt,
  request: ConnectorRequest,
): boolean {
  if (
    receipt.idempotencyKey !== request.idempotencyKey ||
    receipt.opportunityId !== request.opportunityId ||
    receipt.action !== request.action ||
    receipt.connectorId.length < 1
  ) {
    return false;
  }
  if (receipt.status === 'completed') {
    return Boolean(receipt.providerReference && receipt.evidence);
  }
  return receipt.status !== 'paused' || receipt.evidence === null;
}
