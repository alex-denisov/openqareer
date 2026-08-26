import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Clock,
  Sparkle,
  Target,
  X,
} from '@phosphor-icons/react';
import {
  getAvailableSkillQuizzes,
  evaluateSkillQuiz,
  type QuizEvaluationResult,
  type SkillQuiz,
} from '../../services/hhSkillQuizzes';

interface HhSkillQuizSimulatorProps {
  onClose: () => void;
  onBadgeEarned?: (badgeTitle: string) => void;
}

// eslint-disable-next-line max-lines-per-function
export function HhSkillQuizSimulator({
  onClose,
  onBadgeEarned,
}: HhSkillQuizSimulatorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const quizzes = getAvailableSkillQuizzes();
  const [selectedQuiz, setSelectedQuiz] = useState<SkillQuiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizEvaluationResult | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function startQuiz(quiz: SkillQuiz) {
    setSelectedQuiz(quiz);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setResult(null);
  }

  function handleSelectOption(questionId: string, optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  }

  function submitQuiz() {
    if (!selectedQuiz) return;
    const res = evaluateSkillQuiz(selectedQuiz.id, answers);
    setResult(res);
    if (res.passed && onBadgeEarned) {
      onBadgeEarned(selectedQuiz.badgeTitle);
    }
  }

  return (
    <div
      className="career-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-dialog-title"
        className="career-quiz-modal-card"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть симулятор тестов"
          className="career-quiz-modal-close"
        >
          <X size={20} />
        </button>

        {!selectedQuiz && !result ? (
          <div>
            <div className="career-quiz-header-row">
              <div className="career-quiz-icon-badge">
                <Sparkle size={24} weight="fill" />
              </div>
              <h2 id="quiz-dialog-title" className="career-quiz-dialog-title">
                Верификация навыков hh.ru
              </h2>
            </div>
            <p className="career-quiz-intro-text">
              Подготовьтесь и пройдите симуляцию официальных тестов подтверждения навыков hh.ru. Успешное прохождение дает проверенный бейдж в резюме и поднимает профиль в выдаче рекрутеров.
            </p>

            <div className="career-quiz-list">
              {quizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="career-quiz-item"
                >
                  <div className="career-quiz-item-info">
                    <strong className="career-quiz-item-title">
                      {quiz.title}
                    </strong>
                    <span className="career-quiz-item-meta">
                      {quiz.category} · {quiz.questions.length} вопросов · Порог {quiz.passingScorePercent}%
                    </span>
                  </div>
                  <button
                    type="button"
                    className="career-primary-button career-quiz-start-btn"
                    onClick={() => startQuiz(quiz)}
                  >
                    Начать тест
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {selectedQuiz && !result ? (
          <div>
            <div className="career-quiz-topbar">
              <button
                type="button"
                className="career-quiet-button career-quiz-back-btn"
                onClick={() => setSelectedQuiz(null)}
              >
                <ArrowLeft size={16} /> К списку тестов
              </button>
              <div className="career-quiz-counter">
                <Clock size={16} /> Вопрос {currentQuestionIndex + 1} из {selectedQuiz.questions.length}
              </div>
            </div>

            <div className="career-quiz-question-box">
              <h3 id="quiz-dialog-title" className="career-quiz-question-title">
                {selectedQuiz.questions[currentQuestionIndex].question}
              </h3>

              <div className="career-quiz-options">
                {selectedQuiz.questions[currentQuestionIndex].options.map((opt, optIndex) => {
                  const qId = selectedQuiz.questions[currentQuestionIndex].id;
                  const isSelected = answers[qId] === optIndex;
                  return (
                    <button
                      key={optIndex}
                      type="button"
                      onClick={() => handleSelectOption(qId, optIndex)}
                      className={`career-quiz-option ${isSelected ? 'is-selected' : ''}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="career-quiz-footer">
              <button
                type="button"
                className="career-quiet-button"
                disabled={currentQuestionIndex === 0}
                onClick={() => setCurrentQuestionIndex((prev) => prev - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </button>

              {currentQuestionIndex < selectedQuiz.questions.length - 1 ? (
                <button
                  type="button"
                  className="career-primary-button"
                  onClick={() => setCurrentQuestionIndex((prev) => prev + 1)}
                >
                  Далее <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="career-primary-button career-quiz-submit-btn"
                  onClick={submitQuiz}
                >
                  Завершить тест <CheckCircle size={16} weight="bold" />
                </button>
              )}
            </div>
          </div>
        ) : null}

        {result && selectedQuiz ? (
          <div>
            <div
              className={`career-quiz-result-box ${result.passed ? 'is-passed' : 'is-failed'}`}
            >
              {result.passed ? (
                <CheckCircle size={48} weight="fill" className="career-quiz-result-icon is-passed" />
              ) : (
                <Target size={48} weight="fill" className="career-quiz-result-icon is-failed" />
              )}
              <h3 id="quiz-dialog-title" className={`career-quiz-result-title ${result.passed ? 'is-passed' : 'is-failed'}`}>
                {result.passed ? 'Тест успешно пройден!' : 'Тест не пройден'}
              </h3>
              <p className="career-quiz-result-text">
                Результат: <strong>{result.scorePercent}%</strong> ({result.correctAnswersCount} из {result.totalQuestions} правильно)
              </p>
              {result.verifiedBadgeAwarded && result.badge ? (
                <div
                  className="career-quiz-badge-wrap"
                >
                  <Sparkle size={16} weight="fill" /> {result.badge.title}
                </div>
              ) : null}
            </div>

            <h4 className="career-quiz-review-heading">Разбор ответов:</h4>
            <div className="career-quiz-review-list">
              {result.review.map((item, index) => (
                <div
                  key={index}
                  className="career-quiz-review-item"
                >
                  <strong className="career-quiz-review-question">
                    {index + 1}. {item.question}
                  </strong>
                  <span className={`career-quiz-review-status ${item.isCorrect ? 'is-correct' : 'is-incorrect'}`}>
                    {item.isCorrect ? '✓ Правильно' : '✗ Ошибка в ответе'}
                  </span>
                  <small className="career-quiz-review-explanation">
                    {item.explanation}
                  </small>
                </div>
              ))}
            </div>

            <div className="career-quiz-result-footer">
              <button
                type="button"
                className="career-quiet-button"
                onClick={() => {
                  setResult(null);
                  setSelectedQuiz(null);
                }}
              >
                Другие тесты
              </button>
              <button
                type="button"
                className="career-primary-button"
                onClick={onClose}
              >
                Готово
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
