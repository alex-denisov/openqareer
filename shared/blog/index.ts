import type { Guide } from '../guides/types';
import { BLOG_COLLECTION, collectionPath } from '../guides/collection';
import { PROBATION_PERIOD } from './posts/probationPeriod';
import { HOW_TO_QUIT_A_JOB } from './posts/howToQuitAJob';
import { JOB_OFFER_CHECKLIST } from './posts/jobOfferChecklist';
import { QUESTIONS_TO_ASK_AN_EMPLOYER } from './posts/questionsToAskAnEmployer';
import { INTERVIEW_QUESTIONS_AND_ANSWERS } from './posts/interviewQuestionsAndAnswers';
import { WHAT_JOB_SUITS_ME } from './posts/whatJobSuitsMe';
import { CREATE_A_RESUME_ONLINE } from './posts/createAResumeOnline';
import { WHERE_TO_FIND_A_JOB } from './posts/whereToFindAJob';
import { RESUME_TEMPLATE } from './posts/resumeTemplate';

/**
 * B617: статьи блога. Каждая попадает сюда только смёрженным PR после вычитки
 * по чеклисту (хук, ответ в первых 100 словах, цифры с источником) — массовая
 * публикация без вычитки запрещена.
 */
export const BLOG_ROOT = BLOG_COLLECTION.root;

export const BLOG_POSTS: readonly Guide[] = [
  INTERVIEW_QUESTIONS_AND_ANSWERS,
  QUESTIONS_TO_ASK_AN_EMPLOYER,
  WHERE_TO_FIND_A_JOB,
  CREATE_A_RESUME_ONLINE,
  RESUME_TEMPLATE,
  WHAT_JOB_SUITS_ME,
  JOB_OFFER_CHECKLIST,
  PROBATION_PERIOD,
  HOW_TO_QUIT_A_JOB,
];

export function blogPath(slug: string): string {
  return collectionPath(BLOG_COLLECTION, slug);
}

export function findBlogPost(slug: string): Guide | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
