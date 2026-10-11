import type { InterviewSessionView } from './interviewSimulatorApi';

export function QuestionProgress({ session, modeLabel }: {
  readonly session: InterviewSessionView;
  readonly modeLabel: string;
}) {
  const current = Math.min(session.currentQuestionIndex + 1, session.questions.length);
  return (
    <div className="career-mock-progress-block">
      <div className="career-mock-progress-heading">
        <h2>Вопрос {current} из {session.questions.length}</h2>
        <span>{modeLabel}</span>
      </div>
      <progress
        className="career-mock-progress"
        value={current}
        max={session.questions.length}
        aria-label={`Вопрос ${current} из ${session.questions.length}`}
      />
    </div>
  );
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
