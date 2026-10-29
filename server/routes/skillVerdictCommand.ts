import { randomUUID } from 'node:crypto';
import type { CareerActionProposal } from '../domain/coach';
import type { ResumeDraft } from '../domain/resumeDraft';
import {
  CareerCommandPlanner,
  bindResumeRevisionTarget,
} from '../orchestration/careerCommandPlanner';
import {
  currentSkillText,
  serializeSkillState,
  skillKey,
  skillStateAfterQuiz,
} from '../orchestration/skillRevision';
import type { RouteDeps } from './deps';

interface SkillVerdict {
  readonly skillName: string;
  readonly status: string;
  readonly source: string;
  readonly date: string;
  /** `quiz:<id>`: попытка, на которой основан статус. */
  readonly evidenceRef: string;
  readonly proposal: Omit<CareerActionProposal, 'resumeRevision'> & {
    readonly resumeRevision: Record<string, unknown>;
  };
}

/**
 * Статус навыка после квиза пишется командой карьеры: «Принять результат» —
 * согласие кандидата, а /revert может её отменить. Общая часть старого банка
 * квизов и квиза по навыку профиля (блок A, пакет 3).
 */
export function planSkillVerdictCommand(
  deps: RouteDeps,
  candidateId: string,
  commandId: string,
  draft: ResumeDraft,
  verdict: SkillVerdict,
) {
  const key = skillKey(verdict.skillName);
  const revision = {
    ...verdict.proposal.resumeRevision,
    experienceId: key,
    memoryId: null,
    proposedText: serializeSkillState(skillStateAfterQuiz(draft, verdict.skillName, verdict)),
  };
  const executionTarget = bindResumeRevisionTarget(
    revision as Parameters<typeof bindResumeRevisionTarget>[0],
    currentSkillText(draft, key),
  );
  const planner = new CareerCommandPlanner({ createId: () => commandId });
  return deps.candidateStore.saveCareerCommand(
    planner.materialize({
      principal: { candidateId },
      proposal: {
        ...verdict.proposal,
        evidenceRefs: [verdict.evidenceRef],
        resumeRevision: revision,
      } as CareerActionProposal,
      availableEvidenceRefs: new Set([verdict.evidenceRef]),
      strategyDecisionId: `skill-${verdict.evidenceRef}`,
      modelInvocationIds: [],
      idempotencyKey: commandId,
      approval: null,
      executionTarget,
    }),
  );
}

export function approveSkillVerdictCommand(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  command: { readonly commandId: string; readonly capability: CareerActionProposal['kind'] },
): void {
  const consumedAt = new Date();
  candidateStore.approveCareerCommand({
    candidateId,
    commandId: command.commandId,
    approval: {
      id: randomUUID(),
      candidateId,
      commandId: command.commandId,
      capability: command.capability,
      expiresAt: new Date(consumedAt.getTime() + 5 * 60_000).toISOString(),
    },
    consumedAt: consumedAt.toISOString(),
  });
}
