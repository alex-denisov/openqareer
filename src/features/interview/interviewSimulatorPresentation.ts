import {
  countPlannedQuestionTypes,
  estimateInterviewMinutes,
  INTERVIEW_QUESTION_COUNT,
} from '../../../shared/interviewPlan';
import type { InterviewQuestionType, InterviewSessionView } from './interviewSimulatorApi';

export interface InterviewTopicPresentation {
  readonly topic: string;
  readonly answered: number;
  readonly points: number;
  readonly maxPoints: number;
  readonly status: 'Есть' | 'Частично' | 'Нет' | 'Не оценено';
}

const TOPIC_LABELS: Readonly<Record<string, string>> = {
  behavioral: 'Поведенческие вопросы',
  system_design: 'System Design',
};

export function presentInterviewTopics(
  topics: InterviewSessionView['topicSummary'],
): InterviewTopicPresentation[] {
  return topics.map((topic) => ({
    topic: TOPIC_LABELS[topic.topic] ?? topic.topic,
    answered: topic.answered,
    points: topic.points,
    maxPoints: topic.maxPoints,
    status: topicStatus(topic),
  }));
}

function topicStatus(
  topic: InterviewSessionView['topicSummary'][number],
): InterviewTopicPresentation['status'] {
  if (topic.answered === 0 || topic.maxPoints === 0) return 'Не оценено';
  if (topic.points >= topic.maxPoints) return 'Есть';
  if (topic.points === 0) return 'Нет';
  return 'Частично';
}

export function deriveInterviewRecommendations(
  session: Pick<InterviewSessionView, 'questions'>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const question of session.questions) {
    for (const criterion of Object.values(question.answer?.evaluation.criteria ?? {})) {
      const reason = criterion.reason.trim();
      if (criterion.points === 2 || !reason || seen.has(reason)) continue;
      seen.add(reason);
      result.push(reason);
      if (result.length === 3) return result;
    }
  }
  return result;
}

/** Подпись-счёт варианта вопросов: те же числа, что даст план сервера. */
export function presentQuestionScopeCaption(
  questionTypes: readonly InterviewQuestionType[],
): string {
  const counts = countPlannedQuestionTypes(questionTypes);
  return [
    counts.system_design ? `${counts.system_design} по требованиям` : null,
    counts.behavioral ? `${counts.behavioral} по STAR` : null,
  ].filter(Boolean).join(', ');
}

/** «5 вопросов, около 15 минут» для шапки и строки старта. */
export function presentInterviewLength(): string {
  return `${INTERVIEW_QUESTION_COUNT} ${questionWord(INTERVIEW_QUESTION_COUNT)}, около ${estimateInterviewMinutes()} минут`;
}

/** «10.10, 14:00» по локальному времени кандидата. */
export function formatInterviewMoment(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «05.10» — дата источника. */
export function formatSourceDate(value: string): string | null {
  const moment = formatInterviewMoment(value);
  return moment ? moment.slice(0, 5) : null;
}

export function questionWord(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'вопросов';
  const last = count % 10;
  if (last === 1) return 'вопрос';
  if (last >= 2 && last <= 4) return 'вопроса';
  return 'вопросов';
}
