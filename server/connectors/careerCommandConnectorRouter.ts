import type {
  ConnectorExecutor,
  ConnectorReceipt,
  ConnectorRequest,
} from './connectorHarness';

interface CareerCommandConnectorRouterOptions {
  hh: ConnectorExecutor;
}

/** Routes only a candidate-approved, explicitly platform-bound target. */
export class CareerCommandConnectorRouter implements ConnectorExecutor {
  private readonly hh: ConnectorExecutor;

  constructor(options: CareerCommandConnectorRouterOptions) {
    this.hh = options.hh;
  }

  async execute(request: ConnectorRequest): Promise<ConnectorReceipt> {
    if (hasHhTarget(request.payload)) {
      return this.hh.execute(request);
    }
    return {
      connectorId: 'governed-native-handoff',
      transport: 'native_handoff',
      action: request.action,
      status: 'native_handoff',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      evidence: null,
      diagnostic: { reason: 'external_target_not_bound' },
    };
  }
}

function hasHhTarget(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const target = Reflect.get(payload, 'executionTarget');
  return (
    Boolean(target) &&
    typeof target === 'object' &&
    Reflect.get(target, 'platform') === 'hh'
  );
}
