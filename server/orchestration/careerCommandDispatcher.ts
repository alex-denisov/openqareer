import { randomUUID } from 'node:crypto';
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
import type { SqliteProfileRevisionRepository, ProfileRevisionRecord } from '../data/sqliteProfileRevisionRepository';
import type { CareerActionProposal } from '../domain/coach';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import type {
  CareerCommandRecord,
  ResumeReviseExecutionTarget,
} from './careerCommandPlanner';

interface CareerCommandDispatcherOptions {
  store: CandidateStore;
  executor?: ConnectorExecutor;
  profileRevisionRepo?: SqliteProfileRevisionRepository;
  now?: () => Date;
}

export class CareerCommandDispatcher {
  private readonly store: CandidateStore;
  private readonly executor?: ConnectorExecutor;
  private readonly profileRevisionRepo?: SqliteProfileRevisionRepository;
  private readonly now: () => Date;

  constructor(options: CareerCommandDispatcherOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.profileRevisionRepo = options.profileRevisionRepo;
    this.now = options.now ?? (() => new Date());
  }

  async dispatch(
    candidateId: string,
    commandId: string,
  ): Promise<CareerCommandRecord> {
    const command = this.store.getCareerCommand(candidateId, commandId);
    if (!command) throw new Error('career_command_not_found');
    if (command.status !== 'queued') return command;

    if (command.capability === 'resume.revise') {
      return this.dispatchResumeRevise(candidateId, command);
    }
    if (!this.executor) {
      return command;
    }
    return this.dispatchConnectorCommand(candidateId, command);
  }

  private async dispatchConnectorCommand(
    candidateId: string,
    command: CareerCommandRecord,
  ): Promise<CareerCommandRecord> {
    const startedAt = this.now().toISOString();
    const opportunityId = opportunityIdFor(command);
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
    this.store.claimCareerCommand(candidateId, command.commandId, action, startedAt);

    const harness = new ConnectorHarness({
      executor: this.executor!,
      maxActions: 1,
      observedAt: () => this.now().toISOString(),
    });
    const receipt = await harness.execute({
      candidateId,
      idempotencyKey: command.idempotency.key,
      opportunityId,
      action: action.action,
      payload: {
        commandId: command.commandId,
        capability: command.capability,
        approvalId: command.authorization.approvalId,
        executionTarget: command.executionTarget,
      },
    });
    const finishedAt = this.now().toISOString();
    const execution = applyConnectorReceipt(action, receipt, finishedAt);
    return this.store.finishCareerCommand(candidateId, command.commandId, {
      ...command,
      status: finishedStatus(execution.status),
      authorization: { ...command.authorization },
      execution,
      updatedAt: finishedAt,
    });
  }

  private async dispatchResumeRevise(
    candidateId: string,
    command: CareerCommandRecord,
  ): Promise<CareerCommandRecord> {
    const target = command.executionTarget as ResumeReviseExecutionTarget | null;
    if (!target || !('section' in target)) {
      throw new Error('resume_revise_target_missing');
    }

    const startedAt = this.now().toISOString();
    const action = markConnectorActionExecuting(
      createConnectorAction({
        actionId: command.commandId,
        idempotencyKey: command.idempotency.key,
        opportunityId: `command:${command.commandId}`,
        action: 'message',
        autonomy: 'approve_once',
        createdAt: startedAt,
      }),
      startedAt,
    );
    this.store.claimCareerCommand(candidateId, command.commandId, action, startedAt);

    const snapshot = this.store.getSnapshot(candidateId);
    this.confirmEvidenceFacts(candidateId, snapshot, command.proposal.evidenceRefs);

    const currentDraft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
    const { nextDraft, previousText } = applyRevisionToDraft(currentDraft, target);

    const evidenceSnapshot = snapshot.resume?.evidenceSnapshot ?? [];
    this.store.saveResumeDraft(candidateId, nextDraft, evidenceSnapshot);

    const finishedAt = this.now().toISOString();
    if (this.profileRevisionRepo) {
      this.profileRevisionRepo.recordRevision({
        id: randomUUID(),
        candidateId,
        commandId: command.commandId,
        section: target.section,
        experienceId: target.experienceId ?? null,
        previousText,
        appliedText: target.proposedText,
        createdAt: finishedAt,
      });
    }

    return this.store.finishCareerCommand(candidateId, command.commandId, {
      ...command,
      status: 'completed_with_receipt',
      authorization: { ...command.authorization },
      execution: action,
      updatedAt: finishedAt,
    });
  }

  private confirmEvidenceFacts(
    candidateId: string,
    snapshot: ReturnType<CandidateStore['getSnapshot']>,
    evidenceRefs: readonly string[],
  ): void {
    const memoryIds = new Set(snapshot.memory.map((item) => item.id));
    const memoryRefsToConfirm = evidenceRefs.filter((ref) => memoryIds.has(ref));
    if (memoryRefsToConfirm.length > 0) {
      this.store.reviewMemories(candidateId, memoryRefsToConfirm, 'confirm');
    }
  }

  async revert(candidateId: string, commandId: string): Promise<CareerCommandRecord> {
    const command = this.store.getCareerCommand(candidateId, commandId);
    if (!command) throw new Error('career_command_not_found');
    if (!this.profileRevisionRepo) throw new Error('profile_revision_repo_not_configured');

    const revision = this.profileRevisionRepo.getRevisionByCommandId(candidateId, commandId);
    if (!revision) throw new Error('profile_revision_not_found');
    if (revision.revertedAt) return command;

    const snapshot = this.store.getSnapshot(candidateId);
    const currentDraft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
    const revertedDraft = revertDraftRevision(currentDraft, revision);

    const evidenceSnapshot = snapshot.resume?.evidenceSnapshot ?? [];
    this.store.saveResumeDraft(candidateId, revertedDraft, evidenceSnapshot);

    const nowIso = this.now().toISOString();
    this.profileRevisionRepo.markReverted(candidateId, commandId, nowIso);

    return command;
  }
}

function applyRevisionToDraft(
  draft: ResumeDraft,
  target: ResumeReviseExecutionTarget,
): { nextDraft: ResumeDraft; previousText: string } {
  if (target.section === 'headline') {
    const previousText = draft.candidate.headline ?? '';
    return {
      nextDraft: { ...draft, candidate: { ...draft.candidate, headline: target.proposedText } },
      previousText,
    };
  }
  if (target.section === 'about') {
    const previousText = draft.candidate.about ?? '';
    return {
      nextDraft: { ...draft, candidate: { ...draft.candidate, about: target.proposedText } },
      previousText,
    };
  }
  const experiences = [...(draft.experience ?? [])];
  if (target.experienceId) {
    const idx = experiences.findIndex((e) => e.id === target.experienceId);
    if (idx !== -1) {
      const previousText = experiences[idx].title ?? '';
      experiences[idx] = { ...experiences[idx], title: target.proposedText };
      return { nextDraft: { ...draft, experience: experiences }, previousText };
    }
  } else if (experiences.length > 0) {
    const previousText = experiences[0].title ?? '';
    experiences[0] = { ...experiences[0], title: target.proposedText };
    return { nextDraft: { ...draft, experience: experiences }, previousText };
  }
  const newExp = {
    id: `exp-${randomUUID()}`,
    chronologyMemoryId: `chron-${randomUUID()}`,
    title: target.proposedText,
    current: true,
    bulletMemoryIds: [],
  };
  return { nextDraft: { ...draft, experience: [newExp] }, previousText: '' };
}

function revertDraftRevision(
  draft: ResumeDraft,
  revision: ProfileRevisionRecord,
): ResumeDraft {
  if (revision.section === 'headline') {
    return { ...draft, candidate: { ...draft.candidate, headline: revision.previousText } };
  }
  if (revision.section === 'about') {
    return { ...draft, candidate: { ...draft.candidate, about: revision.previousText } };
  }
  const experiences = [...(draft.experience ?? [])];
  if (revision.experienceId) {
    const idx = experiences.findIndex((e) => e.id === revision.experienceId);
    if (idx !== -1) {
      experiences[idx] = { ...experiences[idx], title: revision.previousText };
      return { ...draft, experience: experiences };
    }
  } else if (experiences.length > 0) {
    experiences[0] = { ...experiences[0], title: revision.previousText };
    return { ...draft, experience: experiences };
  }
  return draft;
}

/**
 * A command bound to an external target is addressed by that target, so the
 * harness's at-most-once key and the connector's expected opportunity agree.
 */
function opportunityIdFor(command: CareerCommandRecord): string {
  return command.executionTarget && 'vacancyId' in command.executionTarget
    ? `hh:vacancy:${command.executionTarget.vacancyId}`
    : `command:${command.commandId}`;
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
