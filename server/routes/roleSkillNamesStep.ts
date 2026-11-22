import type { FastifyReply } from 'fastify';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import { runSkillNames, withSkillNames } from '../domain/roleSkillNames';
import type { RouteDeps } from './deps';

/** B734: один вызов перевода на старте; сбой — названия как в вакансиях, проверка не ждёт. */
export async function withRussianSkillNames(
  deps: RouteDeps,
  reply: FastifyReply,
  run: RoleSkillAssessmentRun,
): Promise<RoleSkillAssessmentRun> {
  if (!deps.skillNameTranslator) return run;
  try {
    return withSkillNames(run, await deps.skillNameTranslator.translate(runSkillNames(run)));
  } catch (error) {
    reply.log.warn({ failureType: error instanceof Error ? error.name : 'unknown' }, 'role-skill-names-untranslated');
    return run;
  }
}

