/**
 * Кого называет напоминание об отклике (B542): контакт, который кандидат
 * добавил сам, иначе самый уверенный рекрутер из контактов вакансии.
 */
export interface ResolvedApplicationContact {
  readonly name: string;
  readonly source: 'candidate' | 'vacancy';
}

interface ContactApplication {
  readonly id: string;
  readonly clusterId: string | null;
}

interface VacancyRecruiter {
  readonly vacancyId: string;
  readonly fullName: string;
  readonly confidence: number;
}

function bestRecruiterByVacancy(
  recruiters: readonly VacancyRecruiter[],
): ReadonlyMap<string, VacancyRecruiter> {
  return recruiters
    .filter((recruiter) => recruiter.fullName.trim())
    .reduce((best, recruiter) => {
      const current = best.get(recruiter.vacancyId);
      return current && current.confidence >= recruiter.confidence
        ? best
        : new Map(best).set(recruiter.vacancyId, recruiter);
    }, new Map<string, VacancyRecruiter>());
}

export function resolveApplicationContacts(
  applications: readonly ContactApplication[],
  candidateContacts: ReadonlyMap<string, string>,
  vacancyRecruiters: readonly VacancyRecruiter[],
): ReadonlyMap<string, ResolvedApplicationContact> {
  const recruiters = bestRecruiterByVacancy(vacancyRecruiters);
  return new Map(
    applications.flatMap((application): [string, ResolvedApplicationContact][] => {
      const own = candidateContacts.get(application.id)?.trim();
      if (own) return [[application.id, { name: own, source: 'candidate' }]];
      const recruiter = application.clusterId ? recruiters.get(application.clusterId) : undefined;
      return recruiter
        ? [[application.id, { name: recruiter.fullName.trim(), source: 'vacancy' }]]
        : [];
    }),
  );
}
