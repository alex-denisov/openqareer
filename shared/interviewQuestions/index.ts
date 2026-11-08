import { ACCOUNTANT } from './bank/accountant';
import { CUSTOMER_SUPPORT } from './bank/customerSupport';
import { DATA_ANALYST } from './bank/dataAnalyst';
import { HEAD_SALES } from './bank/headSales';
import { PROJECT_MANAGER } from './bank/projectManager';
import { RECRUITER } from './bank/recruiter';
import { ACCOUNT_MANAGER } from './bank/accountManager';
import { BACKEND_ENGINEER } from './bank/backendEngineer';
import { BUSINESS_DEVELOPMENT_REPRESENTATIVE } from './bank/businessDevelopmentRepresentative';
import { CUSTOMER_SUCCESS_MANAGER } from './bank/customerSuccessManager';
import { DATA_ENGINEER } from './bank/dataEngineer';
import { DEVOPS_ENGINEER } from './bank/devopsEngineer';
import { ENGINEERING_MANAGER } from './bank/engineeringManager';
import { EXECUTIVE_ASSISTANT } from './bank/executiveAssistant';
import { FINANCIAL_CONTROLLER } from './bank/financialController';
import { FP_ANALYST } from './bank/fpAnalyst';
import { FRONTEND_ENGINEER } from './bank/frontendEngineer';
import { FULL_STACK_ENGINEER } from './bank/fullStackEngineer';
import { HEAD_MARKETING } from './bank/headMarketing';
import { HR_BUSINESS_PARTNER } from './bank/hrBusinessPartner';
import { KEY_ACCOUNT_MANAGER } from './bank/keyAccountManager';
import { MARKETING_SPECIALIST } from './bank/marketingSpecialist';
import { MOBILE_ENGINEER } from './bank/mobileEngineer';
import { OPERATIONS_MANAGER } from './bank/operationsManager';
import { PERFORMANCE_MARKETING_SPECIALIST } from './bank/performanceMarketingSpecialist';
import { PRODUCT_MANAGER } from './bank/productManager';
import { SALES_REPRESENTATIVE_ACCOUNT_EXECUTIVE } from './bank/salesRepresentativeAccountExecutive';
import { SOCIAL_MEDIA_MANAGER } from './bank/socialMediaManager';
import { SOLUTIONS_ARCHITECT } from './bank/solutionsArchitect';
import { UX_UI_DESIGNER } from './bank/uxUiDesigner';
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
  ACCOUNT_MANAGER,
  BACKEND_ENGINEER,
  BUSINESS_DEVELOPMENT_REPRESENTATIVE,
  CUSTOMER_SUCCESS_MANAGER,
  DATA_ENGINEER,
  DEVOPS_ENGINEER,
  ENGINEERING_MANAGER,
  EXECUTIVE_ASSISTANT,
  FINANCIAL_CONTROLLER,
  FP_ANALYST,
  FRONTEND_ENGINEER,
  FULL_STACK_ENGINEER,
  HEAD_MARKETING,
  HR_BUSINESS_PARTNER,
  KEY_ACCOUNT_MANAGER,
  MARKETING_SPECIALIST,
  MOBILE_ENGINEER,
  OPERATIONS_MANAGER,
  PERFORMANCE_MARKETING_SPECIALIST,
  PRODUCT_MANAGER,
  SALES_REPRESENTATIVE_ACCOUNT_EXECUTIVE,
  SOCIAL_MEDIA_MANAGER,
  SOLUTIONS_ARCHITECT,
  UX_UI_DESIGNER,
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
