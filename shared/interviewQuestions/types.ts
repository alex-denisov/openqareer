/** B568: public interview question bank. Content is written per profession and read by people
 * before it is indexed; every number shown next to it comes from the pool measurement. */
export type InterviewQuestionKind = 'professional' | 'experience' | 'motivation' | 'money';

/** A requirement the question follows from, matched in vacancy texts of the profession. */
export interface InterviewRequirementTopic {
  readonly label: string;
  /** Case-insensitive regular expression source, Russian and English wording. */
  readonly pattern: string;
}

export interface InterviewQuestion {
  readonly id: string;
  readonly kind: InterviewQuestionKind;
  readonly question: string;
  readonly checks: string;
  readonly strong: string;
  readonly weak?: string;
  readonly topic?: InterviewRequirementTopic;
}

export interface InterviewQuizItem {
  readonly question: string;
  readonly options: readonly string[];
  readonly correct: number;
  readonly explain: string;
}

export interface InterviewProfession {
  /** Same slug as the /salaries role: one profession, one address family. */
  readonly slug: string;
  readonly label: string;
  /** «вопросы на собеседовании бухгалтера» */
  readonly genitive: string;
  /** Date a person read the bank; without it the page stays noindex. */
  readonly reviewedAt?: string;
  readonly questions: readonly InterviewQuestion[];
  readonly quiz: readonly InterviewQuizItem[];
}

/** Pool measurement for one profession (scripts/measure-interview-evidence.ts). */
export interface InterviewProfessionEvidence {
  /** Active vacancies of the profession in the window. */
  readonly vacancies: number;
  /** Of them, vacancies whose source gave the full requirements text. */
  readonly described: number;
  /** Question id → vacancies with a description that mention its topic. */
  readonly topics: Readonly<Record<string, number>>;
}

export interface InterviewEvidence {
  readonly measuredAt: string;
  readonly windowDays: number;
  readonly minDescribed: number;
  readonly professions: Readonly<Record<string, InterviewProfessionEvidence>>;
}
