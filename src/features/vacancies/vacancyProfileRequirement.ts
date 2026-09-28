export interface VacancyProfileRequirement {
  readonly requirement: string;
  readonly vacancyId: string;
  readonly vacancyTitle: string;
  readonly vacancyCompany: string;
}

export interface VacancyProfileRequirementRequest extends VacancyProfileRequirement {
  readonly requestId: string;
}
