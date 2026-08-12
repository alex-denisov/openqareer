import type { CandidateStore } from '../data/candidateStore';
import {
  applyConnectorReceipt,
  createConnectorAction,
  markConnectorActionExecuting,
  type ConnectorActionStatus,
} from '../connectors/connectorActionQueue';
import {
  ConnectorHarness,
  type ConnectorAction,
  type ConnectorExecutor,
} from '../connectors/connectorHarness';
import type { CareerActionProposal } from '../domain/coach';
import type { CareerCommandRecord } from './careerCommandPlanner';

interface CareerCommandDispatcherOptions {
  store: CandidateStore;
  executor: ConnectorExecutor;
  now?: () => Date;
}

export class CareerCommandDispatcher {
  private readonly store: CandidateStore;
  private readonly executor: ConnectorExecutor;
  private readonly now: () => Date;

  constructor(options: CareerCommandDispatcherOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
  }

  async dispatch(
    candidateId: string,
    commandId: string,
  ): Promise<CareerCommandRecord> {
    const command = this.store.getCareerCommand(candidateId, commandId);
    if (!command) throw new Error('career_command_not_found');
    if (command.status !== 'queued') return command;

    const startedAt = this.now().toISOString();
    const opportunityId = `command:${command.commandId}`;
    const action = markConnectorActionExecuting(
      createConnectorAction({
        actionId: command.commandId,
        idempotencyKey: command.idempotency.key,
        opportunityId,
        action: connectorActionFor(command.capability),
        autonomy: 'approve_once',
        createdAt: startedAt,
      }),
      startedAt,
    );
    this.store.claimCareerCommand(
      candidateId,
      commandId,
      action,
      startedAt,
    );

    const harness = new ConnectorHarness({
      executor: this.executor,
      maxActions: 1,
      observedAt: () => this.now().toISOString(),
    });
    const receipt = await harness.execute({
      idempotencyKey: command.idempotency.key,
      opportunityId,
      action: action.action,
      payload: {
        commandId: command.commandId,
        capability: command.capability,
      },
    });
    const finishedAt = this.now().toISOString();
    const execution = applyConnectorReceipt(action, receipt, finishedAt);
    return this.store.finishCareerCommand(candidateId, commandId, {
      ...command,
      status: finishedStatus(execution.status),
      authorization: { ...command.authorization },
      execution,
      updatedAt: finishedAt,
    });
  }
}

function finishedStatus(
  status: ConnectorActionStatus,
): Extract<
  CareerCommandRecord['status'],
  'completed_with_receipt' | 'paused' | 'failed' | 'native_handoff'
> {
  if (status === 'drafted' || status === 'executing') {
    throw new Error('career_command_receipt_not_terminal');
  }
  return status;
}

function connectorActionFor(
  capability: CareerActionProposal['kind'],
): ConnectorAction {
  switch (capability) {
    case 'application.submit':
      return 'application';
    case 'outreach.send':
      return 'message';
    case 'connection.request':
      return 'connection';
    default:
      throw new Error('career_command_capability_not_dispatchable');
  }
}
