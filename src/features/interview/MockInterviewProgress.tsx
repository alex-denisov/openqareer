import type { InterviewSessionView } from './interviewSimulatorApi';

/** Заголовок карточки состояния и счёт «4 / 10» с полосой (макет 14). */
export function QuestionProgress({ session, title }: {
  readonly session: InterviewSessionView;
  readonly title: string;
}) {
  const current = Math.min(session.currentQuestionIndex + 1, session.questions.length);
  return (
    <div className="career-mock-progress-block">
      <h2>{title}</h2>
      <div className="career-mock-progress-count">
        <span>{current} / {session.questions.length}</span>
        <progress
          className="career-mock-progress"
          value={current}
          max={session.questions.length}
          aria-label={`Вопрос ${current} из ${session.questions.length}`}
        />
      </div>
    </div>
  );
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
