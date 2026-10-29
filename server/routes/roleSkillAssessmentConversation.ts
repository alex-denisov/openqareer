import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import { conversationCoverage } from '../domain/skillConfirmation';
import type { RouteDeps } from './deps';

/**
 * Требования роли со статусом беседы (блок A, пакет 3): «Разобрано в беседе»,
 * если требование называет подтверждённый кандидатом факт беседы с числом.
 */
export function withConversation(
  deps: RouteDeps,
  candidateId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const run = data.run as RoleSkillAssessmentRun | undefined;
  const skills = run?.skills ?? (data.skills as readonly { name: string }[] | undefined);
  if (!skills || skills.length === 0) return data;
  const memory = deps.candidateStore.getSnapshot(candidateId)?.memory ?? [];
  return {
    ...data,
    conversation: conversationCoverage(
      skills.map((skill) => skill.name),
      memory,
    ),
  };
}
