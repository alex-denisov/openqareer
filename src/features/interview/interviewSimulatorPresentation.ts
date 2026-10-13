import type { InterviewSessionView } from './interviewSimulatorApi';

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
