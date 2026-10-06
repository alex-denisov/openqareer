import { randomUUID } from 'node:crypto';
import type { CandidateSnapshot, CandidateStore } from '../data/candidateStore';
import {
  applyConnectorReceipt,
  createConnectorAction,
  markConnectorActionExecuting,
  type ConnectorActionStatus,
} from '../connectors/connectorActionQueue';
import {
  ConnectorHarness,
  type ConnectorAction,
  type ConnectorReceipt,
  type ConnectorExecutor,
} from '../connectors/connectorHarness';
import type { ProfileRevisionRecord } from '../data/sqliteProfileRevisionRepository';
import type { CareerActionProposal } from '../domain/coach';
import { CareerCommandNotFoundError } from '../data/sqliteCareerCommandRepository';
import { currentSkillText, writeSkillState } from './skillRevision';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import type { CareerCommandRecord, ResumeReviseExecutionTarget } from './careerCommandPlanner';

interface CareerCommandDispatcherOptions {
  store: CandidateStore;
  executor?: ConnectorExecutor;
  now?: () => Date;
}

export type CareerCommandView = CareerCommandRecord & {
  readonly profileRevisionReverted?: true;
};

export class ProfileRevisionNotFoundError extends Error {
  constructor() {
    super('Для этой команды нет правки профиля.');
    this.name = 'ProfileRevisionNotFoundError';
  }
}

export class ProfileRevisionAlreadyRevertedError extends Error {
  constructor() {
    super('Правка уже откатана.');
    this.name = 'ProfileRevisionAlreadyRevertedError';
  }
}

export class ResumeRevisionConflictError extends Error {
  constructor() {
    super('Профиль изменился после подготовки. Обновите предложение перед повтором.');
    this.name = 'ResumeRevisionConflictError';
  }
}

export class CareerCommandDispatcher {
  private readonly store: CandidateStore;
  private readonly executor?: ConnectorExecutor;
  private readonly now: () => Date;

  constructor(options: CareerCommandDispatcherOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
  }

  list(candidateId: string): CareerCommandView[] {
    return this.store
      .listCareerCommands(candidateId)
      .map((command) => this.withRevisionState(candidateId, command));
  }

  get(candidateId: string, commandId: string): CareerCommandView | null {
    const command = this.store.getCareerCommand(candidateId, commandId);
    return command ? this.withRevisionState(candidateId, command) : null;
  }

  isResumeRevisionCurrent(candidateId: string, command: CareerCommandRecord): boolean {
    if (command.capability !== 'resume.revise' || !command.executionTarget) return false;
    const target = command.executionTarget as ResumeReviseExecutionTarget;
    const snapshot = this.store.getSnapshot(candidateId);
    const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
    return currentTextForResumeRevision(draft, target, snapshot.memory) === target.currentText;
  }

  async dispatch(candidateId: string, commandId: string): Promise<CareerCommandRecord> {
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
    return this.store.transaction(() => this.executeResumeRevision(candidateId, command, target));
  }

  private executeResumeRevision(
    candidateId: string,
    command: CareerCommandRecord,
    target: ResumeReviseExecutionTarget,
  ): CareerCommandRecord {
    const startedAt = this.now().toISOString();
    const action = this.startProfileRevision(command, startedAt);
    this.store.claimCareerCommand(candidateId, command.commandId, action, startedAt);
    const snapshot = this.store.getSnapshot(candidateId);
    const currentDraft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
    const previousText = currentTextForResumeRevision(currentDraft, target, snapshot.memory);
    if (previousText === null || previousText !== target.currentText) {
      throw new ResumeRevisionConflictError();
    }
    this.applyResumeRevision(candidateId, command, target, currentDraft, snapshot);
    const finishedAt = this.now().toISOString();
    this.recordResumeRevision(candidateId, command, target, previousText, finishedAt);
    return this.finishProfileRevision(candidateId, command, action, finishedAt);
  }

  private startProfileRevision(command: CareerCommandRecord, startedAt: string) {
    return markConnectorActionExecuting(
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
  }

  private applyResumeRevision(
    candidateId: string,
    command: CareerCommandRecord,
    target: ResumeReviseExecutionTarget,
    currentDraft: ResumeDraft,
    snapshot: CandidateSnapshot,
  ): void {
    if (target.memoryId) {
      const revised = this.store.changeMemory(candidateId, target.memoryId, {
        action: 'correct',
        statement: target.proposedText,
      });
      if (!revised) throw new ResumeRevisionConflictError();
    } else {
      this.store.saveResumeDraft(
        candidateId,
        applyRevisionToDraft(currentDraft, target),
        snapshot.resume?.evidenceSnapshot ?? [],
      );
    }
    const evidenceSnapshot = target.memoryId ? this.store.getSnapshot(candidateId) : snapshot;
    this.confirmEvidenceFacts(candidateId, evidenceSnapshot, command.proposal.evidenceRefs);
  }

  private finishProfileRevision(
    candidateId: string,
    command: CareerCommandRecord,
    action: ReturnType<typeof markConnectorActionExecuting>,
    finishedAt: string,
  ): CareerCommandRecord {
    const execution = applyConnectorReceipt(
      action,
      profileRevisionReceipt(action, finishedAt),
      finishedAt,
    );
    return this.store.finishCareerCommand(candidateId, command.commandId, {
      ...command,
      status: 'completed_with_receipt',
      authorization: { ...command.authorization },
      execution,
      updatedAt: finishedAt,
    });
  }

  private recordResumeRevision(
    candidateId: string,
    command: CareerCommandRecord,
    target: ResumeReviseExecutionTarget,
    previousText: string,
    finishedAt: string,
  ): void {
    this.store.profileRevisionRepo.recordRevision({
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

  private confirmEvidenceFacts(
    candidateId: string,
    snapshot: ReturnType<CandidateStore['getSnapshot']>,
    evidenceRefs: readonly string[],
  ): void {
    const memoryIds = new Set(snapshot.memory.map((item) => item.id));
    const memoryRefsToConfirm = evidenceRefs
      .map((ref) => (ref.startsWith('memory:') ? ref.slice('memory:'.length) : ref))
      .filter((ref) => memoryIds.has(ref));
    if (memoryRefsToConfirm.length > 0) {
      this.store.reviewMemories(candidateId, memoryRefsToConfirm, 'confirm');
    }
  }

  async revert(candidateId: string, commandId: string): Promise<CareerCommandRecord> {
    const command = this.store.getCareerCommand(candidateId, commandId);
    if (!command) throw new CareerCommandNotFoundError();
    return this.store.transaction(() => {
      const revision = this.store.profileRevisionRepo.getRevisionByCommandId(
        candidateId,
        commandId,
      );
      if (!revision) throw new ProfileRevisionNotFoundError();
      if (revision.revertedAt) throw new ProfileRevisionAlreadyRevertedError();

      const snapshot = this.store.getSnapshot(candidateId);
      const currentDraft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
      const target = command.executionTarget as ResumeReviseExecutionTarget;
      const currentText = currentTextForResumeRevision(currentDraft, target, snapshot.memory);
      if (currentText === null || currentText !== revision.appliedText) {
        throw new ResumeRevisionConflictError();
      }
      if (target.memoryId) {
        const reverted = this.store.changeMemory(candidateId, target.memoryId, {
          action: 'correct',
          statement: revision.previousText,
        });
        if (!reverted) throw new ResumeRevisionConflictError();
        this.confirmEvidenceFacts(
          candidateId,
          this.store.getSnapshot(candidateId),
          command.proposal.evidenceRefs,
        );
      } else {
        const revertedDraft = revertDraftRevision(currentDraft, revision);
        this.store.saveResumeDraft(
          candidateId,
          revertedDraft,
          snapshot.resume?.evidenceSnapshot ?? [],
        );
      }
      this.store.profileRevisionRepo.markReverted(candidateId, commandId, this.now().toISOString());
      return command;
    });
  }

  private withRevisionState(candidateId: string, command: CareerCommandRecord): CareerCommandView {
    if (command.capability !== 'resume.revise') return command;
    const revision = this.store.profileRevisionRepo.getRevisionByCommandId(
      candidateId,
      command.commandId,
    );
    return revision?.revertedAt ? { ...command, profileRevisionReverted: true } : command;
  }
}

export function currentTextForResumeRevision(
  draft: ResumeDraft,
  target: {
    readonly section: ResumeReviseExecutionTarget['section'];
    readonly experienceId?: string | null;
    readonly memoryId?: string | null;
  },
  memory: CandidateSnapshot['memory'] = [],
): string | null {
  if (target.section === 'headline') {
    return draft.candidate.headline ?? '';
  }
  if (target.section === 'about') {
    return draft.candidate.about ?? '';
  }
  if (target.section === 'skills') {
    return target.experienceId ? currentSkillText(draft, target.experienceId) : null;
  }
  if (!target.experienceId) return null;
  const experience = draft.experience.find((entry) => entry.id === target.experienceId);
  if (!experience) return null;
  if (!target.memoryId) return experience.title ?? '';
  if (!experience.bulletMemoryIds.includes(target.memoryId)) return null;
  const fact = memory.find((item) => item.id === target.memoryId);
  return fact?.status === 'confirmed' ? fact.statement : null;
}

function applyRevisionToDraft(
  draft: ResumeDraft,
  target: ResumeReviseExecutionTarget,
): ResumeDraft {
  if (target.section === 'headline') {
    return { ...draft, candidate: { ...draft.candidate, headline: target.proposedText } };
  }
  if (target.section === 'about') {
    return { ...draft, candidate: { ...draft.candidate, about: target.proposedText } };
  }
  if (target.section === 'skills') {
    if (!target.experienceId) throw new ResumeRevisionConflictError();
    return writeSkillState(draft, target.experienceId, target.proposedText);
  }
  const experiences = [...draft.experience];
  const idx = experiences.findIndex((entry) => entry.id === target.experienceId);
  if (idx < 0) throw new ResumeRevisionConflictError();
  experiences[idx] = { ...experiences[idx], title: target.proposedText };
  return { ...draft, experience: experiences };
}

function revertDraftRevision(draft: ResumeDraft, revision: ProfileRevisionRecord): ResumeDraft {
  if (revision.section === 'headline') {
    return { ...draft, candidate: { ...draft.candidate, headline: revision.previousText } };
  }
  if (revision.section === 'about') {
    return { ...draft, candidate: { ...draft.candidate, about: revision.previousText } };
  }
  if (revision.section === 'skills') {
    if (!revision.experienceId) throw new ResumeRevisionConflictError();
    return writeSkillState(draft, revision.experienceId, revision.previousText);
  }
  const experiences = [...draft.experience];
  const idx = experiences.findIndex((entry) => entry.id === revision.experienceId);
  if (idx < 0) throw new ResumeRevisionConflictError();
  experiences[idx] = { ...experiences[idx], title: revision.previousText };
  return { ...draft, experience: experiences };
}

function profileRevisionReceipt(
  action: ReturnType<typeof markConnectorActionExecuting>,
  at: string,
): ConnectorReceipt {
  return {
    connectorId: 'openqareer-profile-revision',
    transport: 'internal',
    action: action.action,
    status: 'completed',
    idempotencyKey: action.idempotencyKey,
    opportunityId: action.opportunityId,
    providerReference: `revision:${action.actionId}`,
    evidence: { kind: 'candidate_confirmation', observedAt: at },
  };
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

function connectorActionFor(capability: CareerActionProposal['kind']): ConnectorAction {
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
