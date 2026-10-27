import { ACCOUNTANT } from './bank/accountant';
import { CUSTOMER_SUPPORT } from './bank/customerSupport';
import { DATA_ANALYST } from './bank/dataAnalyst';
import { HEAD_SALES } from './bank/headSales';
import { PROJECT_MANAGER } from './bank/projectManager';
import { RECRUITER } from './bank/recruiter';
import evidenceJson from './evidence.json';
import type {
  InterviewEvidence,
  InterviewProfession,
  InterviewProfessionEvidence,
  InterviewQuestion,
} from './types';

export type * from './types';

export const INTERVIEW_HUB_PATH = '/tools/interview-questions';
/** Questions shown in full without an account; the rest open after free sign-up. */
export const INTERVIEW_OPEN_QUESTIONS = 10;
export const INTERVIEW_QUIZ_LENGTH = 5;

export const INTERVIEW_PROFESSIONS: readonly InterviewProfession[] = [
  ACCOUNTANT,
  PROJECT_MANAGER,
  DATA_ANALYST,
  RECRUITER,
  CUSTOMER_SUPPORT,
  HEAD_SALES,
];

export const INTERVIEW_EVIDENCE = evidenceJson as InterviewEvidence;

export function interviewProfession(slug: string): InterviewProfession | undefined {
  return INTERVIEW_PROFESSIONS.find((row) => row.slug === slug);
}

export function interviewProfessionPath(slug: string): string {
  return `${INTERVIEW_HUB_PATH}/${slug}`;
}

export function interviewEvidence(slug: string): InterviewProfessionEvidence | undefined {
  return INTERVIEW_EVIDENCE.professions[slug];
}

/** Published only with enough vacancy texts to ground the questions in requirements. */
export function interviewProfessionPublished(profession: InterviewProfession): boolean {
  const evidence = interviewEvidence(profession.slug);
  return (
    evidence !== undefined &&
    evidence.described >= INTERVIEW_EVIDENCE.minDescribed &&
    profession.questions.length > INTERVIEW_OPEN_QUESTIONS &&
    profession.quiz.length === INTERVIEW_QUIZ_LENGTH
  );
}

/** Indexed only after a person read the bank (reviewedAt); otherwise noindex. */
export function interviewProfessionIndexable(profession: InterviewProfession): boolean {
  return interviewProfessionPublished(profession) && Boolean(profession.reviewedAt);
}

export function publishedInterviewProfessions(): readonly InterviewProfession[] {
  return INTERVIEW_PROFESSIONS.filter(interviewProfessionPublished);
}

export function openInterviewQuestions(
  profession: InterviewProfession,
): readonly InterviewQuestion[] {
  return profession.questions.slice(0, INTERVIEW_OPEN_QUESTIONS);
}

export function lockedInterviewQuestions(
  profession: InterviewProfession,
): readonly InterviewQuestion[] {
  return profession.questions.slice(INTERVIEW_OPEN_QUESTIONS);
}
