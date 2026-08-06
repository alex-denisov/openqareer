import { z } from 'zod';
import {
  connectorActionSchema,
  connectorReceiptSchema,
  type ConnectorAction,
  type ConnectorReceipt,
  type ConnectorTransport,
} from './connectorHarness';

const actionInputSchema = z.object({
  actionId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  idempotencyKey: z.string().uuid(),
  opportunityId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  action: connectorActionSchema,
  autonomy: z.enum(['approve_once', 'bounded_campaign']),
  createdAt: z.string().datetime(),
});

export type ConnectorActionStatus =
  | 'drafted'
  | 'executing'
  | 'completed_with_receipt'
  | 'paused'
  | 'failed'
  | 'native_handoff';

interface ActionHistoryEntry {
  from: ConnectorActionStatus | null;
  to: ConnectorActionStatus;
  at: string;
  reason: string | null;
}

export interface ConnectorActionRecord {
  actionId: string;
  idempotencyKey: string;
  opportunityId: string;
  action: ConnectorAction;
  autonomy: 'approve_once' | 'bounded_campaign';
  status: ConnectorActionStatus;
  createdAt: string;
  updatedAt: string;
  connector: {
    id: string;
    transport: ConnectorTransport;
    providerReference: string | null;
    evidenceKind:
      | 'provider_receipt'
      | 'dom_confirmation'
      | 'candidate_confirmation'
      | null;
    evidenceObservedAt: string | null;
  } | null;
  diagnosticReason: string | null;
  history: ActionHistoryEntry[];
}

export function createConnectorAction(
  input: z.input<typeof actionInputSchema>,
): ConnectorActionRecord {
  const value = actionInputSchema.parse(input);
  return {
    ...value,
    status: 'drafted',
    updatedAt: value.createdAt,
    connector: null,
    diagnosticReason: null,
    history: [
      {
        from: null,
        to: 'drafted',
        at: value.createdAt,
        reason: null,
      },
    ],
  };
}

export function markConnectorActionExecuting(
  record: ConnectorActionRecord,
  at: string,
): ConnectorActionRecord {
  const timestamp = z.string().datetime().parse(at);
  if (record.status !== 'drafted') {
    throw new Error('connector_action_not_drafted');
  }
  return transition(record, 'executing', timestamp, null, {
    connector: null,
    diagnosticReason: null,
  });
}

export function applyConnectorReceipt(
  record: ConnectorActionRecord,
  receipt: ConnectorReceipt,
  at: string,
): ConnectorActionRecord {
  const timestamp = z.string().datetime().parse(at);
  if (record.status !== 'executing') {
    throw new Error('connector_action_not_executing');
  }
  const boundary = connectorReceiptSchema.safeParse(receipt);
  if (!boundary.success) {
    throw new Error('connector_receipt_invalid');
  }
  const value = boundary.data;
  if (
    value.idempotencyKey !== record.idempotencyKey ||
    value.opportunityId !== record.opportunityId ||
    value.action !== record.action
  ) {
    throw new Error('connector_receipt_envelope_mismatch');
  }
  if (
    value.status === 'completed' &&
    (!value.providerReference || !value.evidence)
  ) {
    throw new Error('connector_receipt_not_verified');
  }
  const status = receiptStatus(value.status);
  return transition(
    record,
    status,
    timestamp,
    value.diagnostic?.reason ?? null,
    {
      connector: {
        id: value.connectorId,
        transport: value.transport,
        providerReference: value.providerReference ?? null,
        evidenceKind: value.evidence?.kind ?? null,
        evidenceObservedAt: value.evidence?.observedAt ?? null,
      },
      diagnosticReason: value.diagnostic?.reason ?? null,
    },
  );
}

function receiptStatus(
  status: ConnectorReceipt['status'],
): Exclude<ConnectorActionStatus, 'drafted' | 'executing'> {
  switch (status) {
    case 'completed':
      return 'completed_with_receipt';
    case 'native_handoff':
      return 'native_handoff';
    case 'paused':
      return 'paused';
    case 'failed':
      return 'failed';
  }
}

function transition(
  record: ConnectorActionRecord,
  status: ConnectorActionStatus,
  at: string,
  reason: string | null,
  updates: Pick<ConnectorActionRecord, 'connector' | 'diagnosticReason'>,
): ConnectorActionRecord {
  return {
    ...record,
    ...updates,
    status,
    updatedAt: at,
    history: [
      ...record.history,
      {
        from: record.status,
        to: status,
        at,
        reason,
      },
    ],
  };
}
