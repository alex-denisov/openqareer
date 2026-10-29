import { useCallback, useRef, useState } from 'react';
import {
  applySkillQuizAttempt,
  generateSkillQuiz,
  skillConfirmationErrorText,
  submitSkillQuiz,
  type GeneratedSkillQuiz,
  type SkillQuizLevel,
  type SkillQuizSubmitResult,
} from './skillConfirmationApi';

export type SkillQuizPhase =
  | { readonly kind: 'level' }
  | { readonly kind: 'generating' }
  | { readonly kind: 'questions'; readonly quiz: GeneratedSkillQuiz }
  | { readonly kind: 'submitting'; readonly quiz: GeneratedSkillQuiz }
  | { readonly kind: 'result'; readonly submitted: SkillQuizSubmitResult }
  | { readonly kind: 'applied'; readonly submitted: SkillQuizSubmitResult };

/** The quiz path of one skill: level → generation → answers → result → apply. */
export function useSkillQuizFlow(skillName: string, onApplied: () => void) {
  const [phase, setPhase] = useState<SkillQuizPhase>({ kind: 'level' });
  const [answers, setAnswers] = useState<Readonly<Record<string, number>>>({});
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const applyKey = useRef<string>();
  const busy = useRef(false);

  const start = useCallback(
    async (level: SkillQuizLevel) => {
      if (busy.current) return;
      busy.current = true;
      setError('');
      setPhase({ kind: 'generating' });
      try {
        const quiz = await generateSkillQuiz({ skillName, level });
        setAnswers({});
        setPhase({ kind: 'questions', quiz });
      } catch (reason) {
        setError(skillConfirmationErrorText(reason));
        setPhase({ kind: 'level' });
      } finally {
        busy.current = false;
      }
    },
    [skillName],
  );

  const answer = useCallback((questionId: string, optionIndex: number) => {
    setAnswers((current) => ({ ...current, [questionId]: optionIndex }));
  }, []);

  const submit = useCallback(async () => {
    if (phase.kind !== 'questions' || busy.current) return;
    const quiz = phase.quiz;
    busy.current = true;
    setError('');
    setPhase({ kind: 'submitting', quiz });
    try {
      const submitted = await submitSkillQuiz({ attemptId: quiz.attemptId, answers });
      setPhase({ kind: 'result', submitted });
    } catch (reason) {
      setError(skillConfirmationErrorText(reason));
      setPhase({ kind: 'questions', quiz });
    } finally {
      busy.current = false;
    }
  }, [phase, answers]);

  const apply = useCallback(async () => {
    if (phase.kind !== 'result' || busy.current) return;
    const submitted = phase.submitted;
    applyKey.current ??= crypto.randomUUID();
    busy.current = true;
    setApplying(true);
    setError('');
    try {
      await applySkillQuizAttempt({
        attemptId: submitted.attemptId,
        idempotencyKey: applyKey.current,
      });
      setPhase({ kind: 'applied', submitted });
      onApplied();
    } catch (reason) {
      setError(skillConfirmationErrorText(reason));
    } finally {
      busy.current = false;
      setApplying(false);
    }
  }, [phase, onApplied]);

  return { phase, answers, error, applying, start, answer, submit, apply };
}
