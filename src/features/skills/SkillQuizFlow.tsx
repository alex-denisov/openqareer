import { CheckCircle, CircleNotch, XCircle } from '@phosphor-icons/react';
import type { GeneratedSkillQuiz, SkillQuizSubmitResult } from './skillConfirmationApi';
import { SKILL_QUIZ_LEVELS } from './skillConfirmationLabels';
import { useSkillQuizFlow } from './useSkillQuizFlow';

function LevelStep({
  onPick,
}: {
  readonly onPick: (level: (typeof SKILL_QUIZ_LEVELS)[number]['id']) => void;
}) {
  return (
    <div className="skill-confirm-step">
      <p>8 вопросов, около 5 минут. Выберите уровень, на котором хотите проверить навык.</p>
      <div className="skill-confirm-levels">
        {SKILL_QUIZ_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            className="career-secondary-button"
            onClick={() => onPick(level.id)}
          >
            {level.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Questions({
  quiz,
  answers,
  disabled,
  onAnswer,
  onSubmit,
}: {
  readonly quiz: GeneratedSkillQuiz;
  readonly answers: Readonly<Record<string, number>>;
  readonly disabled: boolean;
  readonly onAnswer: (questionId: string, optionIndex: number) => void;
  readonly onSubmit: () => void;
}) {
  const answered = quiz.questions.filter((question) => answers[question.id] !== undefined).length;
  return (
    <div className="skill-confirm-step">
      {quiz.questions.map((question, index) => (
        <fieldset key={question.id} className="skill-confirm-question" disabled={disabled}>
          <legend>
            {index + 1}. {question.question}
          </legend>
          {question.options.map((option, optionIndex) => (
            <label key={optionIndex} className="skill-confirm-option">
              <input
                type="radio"
                name={question.id}
                checked={answers[question.id] === optionIndex}
                onChange={() => onAnswer(question.id, optionIndex)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <div className="skill-confirm-actions">
        <span className="skill-confirm-count">
          Отвечено {answered} из {quiz.questions.length}
        </span>
        <button
          type="button"
          className="career-primary-button"
          disabled={disabled || answered < quiz.questions.length}
          onClick={onSubmit}
        >
          Сдать
        </button>
      </div>
    </div>
  );
}

function Review({ submitted }: { readonly submitted: SkillQuizSubmitResult }) {
  const { result } = submitted;
  return (
    <ol className="skill-confirm-review" aria-label="Разбор ответов">
      {result.review.map((item) => (
        <li key={item.questionId} className={item.isCorrect ? 'is-correct' : 'is-wrong'}>
          <b>{item.question}</b>
          <span>{item.isCorrect ? 'Верно.' : 'Неверно.'}</span>
          <p>{item.explanation}</p>
        </li>
      ))}
    </ol>
  );
}

function Result({
  submitted,
  applied,
  applying,
  onApply,
}: {
  readonly submitted: SkillQuizSubmitResult;
  readonly applied: boolean;
  readonly applying: boolean;
  readonly onApply: () => void;
}) {
  const { result } = submitted;
  const Icon = result.passed ? CheckCircle : XCircle;
  return (
    <div className="skill-confirm-step">
      <p className={`skill-confirm-score ${result.passed ? 'is-ok' : 'is-warn'}`}>
        <Icon size="1.25em" aria-hidden="true" />
        {result.scorePercent}%: верно {result.correctAnswersCount} из {result.totalQuestions}.{' '}
        {result.passed ? 'Порог пройден.' : 'Порог не пройден.'}
      </p>
      <Review submitted={submitted} />
      {applied ? (
        <p role="status">Результат принят.</p>
      ) : (
        <button
          type="button"
          className="career-primary-button"
          disabled={applying}
          onClick={onApply}
        >
          Принять результат
        </button>
      )}
    </div>
  );
}

export function SkillQuizFlow({
  skillName,
  onApplied,
}: {
  readonly skillName: string;
  readonly onApplied: () => void;
}) {
  const flow = useSkillQuizFlow(skillName, onApplied);
  const { phase } = flow;
  return (
    <div className="skill-confirm-flow">
      {phase.kind === 'level' ? <LevelStep onPick={flow.start} /> : null}
      {phase.kind === 'generating' ? (
        <p className="skill-confirm-progress" role="status">
          <CircleNotch size="1.25em" aria-hidden="true" /> Собираем 8 вопросов… Это займёт до
          минуты.
        </p>
      ) : null}
      {phase.kind === 'questions' || phase.kind === 'submitting' ? (
        <Questions
          quiz={phase.quiz}
          answers={flow.answers}
          disabled={phase.kind === 'submitting'}
          onAnswer={flow.answer}
          onSubmit={flow.submit}
        />
      ) : null}
      {phase.kind === 'result' || phase.kind === 'applied' ? (
        <Result
          submitted={phase.submitted}
          applied={phase.kind === 'applied'}
          applying={flow.applying}
          onApply={flow.apply}
        />
      ) : null}
      {flow.error ? (
        <p className="skill-confirm-error" role="alert">
          {flow.error}
        </p>
      ) : null}
    </div>
  );
}
