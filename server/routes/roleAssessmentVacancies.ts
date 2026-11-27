import { createHash } from 'node:crypto';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import type { RoleAssessmentVacancy } from '../domain/roleSkillAssessment';
import { isRoleTitleLabel } from '../domain/roleTitleLabel';
import type { readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { MAX_VACANCY_AGE_DAYS } from '../vacancies/vacancyPoolQuery';
import { mapInSteps, runSteps, type Steps } from '../vacancies/yieldingSteps';
import type { RoleRequirementReader } from './roleSkillRequirementSource';

export function toAssessmentVacancies(
  matched: Awaited<ReturnType<typeof readMatchedSnapshot>>,
  roleId: string,
  now: Date,
  requirementReader?: RoleRequirementReader,
): RoleAssessmentVacancy[] {
  return runSteps(assessmentVacancySteps(matched, roleId, now, requirementReader));
}

/** One vacancy per step: the requirement reader parses and labels its whole text. */
export function* assessmentVacancySteps(
  matched: Awaited<ReturnType<typeof readMatchedSnapshot>>,
  roleId: string,
  now: Date,
  requirementReader?: RoleRequirementReader,
): Steps<RoleAssessmentVacancy[]> {
  const vacancies = yield* mapInSteps(
    matched,
    (item) => toAssessmentVacancy(item, roleId, now, requirementReader),
    1,
  );
  return vacancies.flat();
}

function toAssessmentVacancy(
  { cluster, explanation }: Awaited<ReturnType<typeof readMatchedSnapshot>>[number],
  roleId: string,
  now: Date,
  requirementReader?: RoleRequirementReader,
): RoleAssessmentVacancy[] {
  const cutoff = now.getTime() - MAX_VACANCY_AGE_DAYS * 24 * 60 * 60 * 1_000;
  if (cluster.status !== 'active' || explanation.roleMatch !== 'target') return [];
  const sourceRefs = cluster.sources.flatMap((source) => {
    const observedAtMs = Date.parse(source.observedAt);
    if (!Number.isFinite(observedAtMs) || observedAtMs < cutoff || observedAtMs > now.getTime())
      return [];
    return [
      {
        sourceId: source.sourceId,
        observedAt: source.observedAt,
        sourceName: source.sourceName ?? 'Источник вакансии',
      },
    ];
  });
  const freshness = sourceRefs.length > 0 ? ('fresh' as const) : ('stale' as const);
  const labels =
    cluster.skills.length > 0 || freshness !== 'fresh' || !requirementReader
      ? cluster.skills
      : requirementReader.skillsFor(cluster.id);
  const requirements = labels
    .filter((label) => !isRoleTitleLabel(label))
    .map((label) => {
      const normalizedSkill = canonicalizeSkill(label).trim();
      const skillId = normalizeSkillId(normalizedSkill);
      return {
        id: `requirement-${stableRefId(cluster.id, skillId)}`,
        skillId,
        statement: label.trim(),
        sourceRefs: sourceRefs.map((source) => ({
          id: stableRefId(cluster.id, `${source.sourceId}:${skillId}`),
          vacancyId: cluster.id,
          observedAt: source.observedAt,
          sourceName: source.sourceName,
        })),
      };
    });
  return [{ id: cluster.id, roleId, status: 'active' as const, freshness, requirements }];
}

function normalizeSkillId(value: string): string {
  return (
    value
      .toLocaleLowerCase('ru-RU')
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 70) || 'skill'
  );
}

function stableRefId(left: string, right: string): string {
  return createHash('sha256').update(`${left}\u0000${right}`).digest('hex').slice(0, 32);
}
