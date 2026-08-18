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
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-dialog-title"
        className="career-quiz-modal-card"
        style={{
          background: 'var(--surface-raised, oklch(22% 0.02 255 / 0.96))',
          color: 'var(--text-main, #f3f4f6)',
          border: '1px solid var(--line-strong, rgba(255, 255, 255, 0.16))',
          borderRadius: '20px',
          maxWidth: '720px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 'clamp(20px, 4vw, 32px)',
          boxShadow: '0 28px 64px rgba(0, 0, 0, 0.65)',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть симулятор тестов"
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '50%',
            color: 'var(--text-muted, #9ca3af)',
            cursor: 'pointer',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '36px',
            minHeight: '36px',
          }}
        >
          <X size={20} />
        </button>

        {!selectedQuiz && !result ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'oklch(79% 0.14 255 / 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary-accent, #38bdf8)',
                }}
              >
                <Sparkle size={24} weight="fill" />
              </div>
              <h2 id="quiz-dialog-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 650 }}>
                Верификация навыков hh.ru
              </h2>
            </div>
            <p style={{ color: 'var(--text-muted, #9ca3af)', fontSize: '0.88rem', marginBottom: '24px', lineHeight: 1.55 }}>
              Подготовьтесь и пройдите симуляцию официальных тестов подтверждения навыков hh.ru. Успешное прохождение дает проверенный бейдж в резюме и поднимает профиль в выдаче рекрутеров.
            </p>

            <div style={{ display: 'grid', gap: '12px' }}>
              {quizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '16px 20px',
                    background: 'var(--surface-soft, rgba(255, 255, 255, 0.04))',
                    border: '1px solid var(--line, rgba(255, 255, 255, 0.1))',
                    borderRadius: '14px',
                  }}
                >
                  <div style={{ minWidth: '240px', flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: '0.98rem', marginBottom: '4px' }}>
                      {quiz.title}
                    </strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim, #9ca3af)' }}>
                      {quiz.category} · {quiz.questions.length} вопросов · Порог {quiz.passingScorePercent}%
                    </span>
                  </div>
                  <button
                    type="button"
                    className="career-primary-button"
                    style={{ padding: '8px 18px', fontSize: '0.85rem', borderRadius: '10px' }}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <button
                type="button"
                className="career-quiet-button"
                style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                onClick={() => setSelectedQuiz(null)}
              >
                <ArrowLeft size={16} /> К списку тестов
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-muted, #9ca3af)' }}>
                <Clock size={16} /> Вопрос {currentQuestionIndex + 1} из {selectedQuiz.questions.length}
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h3 id="quiz-dialog-title" style={{ fontSize: '1.08rem', fontWeight: 600, marginBottom: '18px', lineHeight: 1.45 }}>
                {selectedQuiz.questions[currentQuestionIndex].question}
              </h3>

              <div style={{ display: 'grid', gap: '10px' }}>
                {selectedQuiz.questions[currentQuestionIndex].options.map((opt, optIndex) => {
                  const qId = selectedQuiz.questions[currentQuestionIndex].id;
                  const isSelected = answers[qId] === optIndex;
                  return (
                    <button
                      key={optIndex}
                      type="button"
                      onClick={() => handleSelectOption(qId, optIndex)}
                      style={{
                        textAlign: 'left',
                        padding: '14px 18px',
                        borderRadius: '12px',
                        background: isSelected ? 'oklch(79% 0.14 255 / 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected ? '1px solid var(--primary-accent, #38bdf8)' : '1px solid var(--line, rgba(255, 255, 255, 0.1))',
                        color: 'var(--text-main, #f3f4f6)',
                        cursor: 'pointer',
                        fontSize: '0.88rem',
                        lineHeight: 1.45,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
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
                  className="career-primary-button"
                  style={{ background: 'var(--primary-success, #22c55e)', borderColor: 'var(--primary-success, #22c55e)' }}
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
              style={{
                textAlign: 'center',
                padding: '24px',
                borderRadius: '16px',
                background: result.passed ? 'oklch(75% 0.14 154 / 0.12)' : 'oklch(68% 0.18 28 / 0.12)',
                border: `1px solid ${result.passed ? 'oklch(75% 0.14 154 / 0.35)' : 'oklch(68% 0.18 28 / 0.35)'}`,
                marginBottom: '24px',
              }}
            >
              {result.passed ? (
                <CheckCircle size={48} weight="fill" style={{ color: 'var(--primary-success, #22c55e)', margin: '0 auto 12px' }} />
              ) : (
                <Target size={48} weight="fill" style={{ color: 'var(--danger-red, #ef4444)', margin: '0 auto 12px' }} />
              )}
              <h3 id="quiz-dialog-title" style={{ fontSize: '1.2rem', margin: '0 0 8px', color: result.passed ? 'var(--primary-success, #22c55e)' : 'var(--danger-red, #ef4444)' }}>
                {result.passed ? 'Тест успешно пройден!' : 'Тест не пройден'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.94rem' }}>
                Результат: <strong>{result.scorePercent}%</strong> ({result.correctAnswersCount} из {result.totalQuestions} правильно)
              </p>
              {result.verifiedBadgeAwarded && result.badge ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 18px',
                    background: 'oklch(75% 0.14 154 / 0.22)',
                    border: '1px solid oklch(75% 0.14 154 / 0.4)',
                    borderRadius: '24px',
                    marginTop: '16px',
                    fontSize: '0.85rem',
                    fontWeight: 650,
                    color: 'var(--primary-success, #22c55e)',
                  }}
                >
                  <Sparkle size={16} weight="fill" /> {result.badge.title}
                </div>
              ) : null}
            </div>

            <h4 style={{ fontSize: '0.96rem', marginBottom: '14px', fontWeight: 650 }}>Разбор ответов:</h4>
            <div style={{ display: 'grid', gap: '10px', maxHeight: '280px', overflowY: 'auto', marginBottom: '24px' }}>
              {result.review.map((item, index) => (
                <div
                  key={index}
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
                    fontSize: '0.82rem',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: '6px' }}>
                    {index + 1}. {item.question}
                  </strong>
                  <span style={{ color: item.isCorrect ? 'var(--primary-success, #22c55e)' : 'var(--danger-red, #ef4444)', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                    {item.isCorrect ? '✓ Правильно' : '✗ Ошибка в ответе'}
                  </span>
                  <small style={{ color: 'var(--text-muted, #9ca3af)', lineHeight: 1.45, display: 'block' }}>
                    {item.explanation}
                  </small>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
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
