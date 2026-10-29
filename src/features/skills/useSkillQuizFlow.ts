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

/** Runs one request at a time; a failure becomes the readable error line. */
function useGuardedRequest(setError: (text: string) => void) {
  const busy = useRef(false);
  return useCallback(
    async (task: () => Promise<void>, onFailure: () => void = () => undefined) => {
      if (busy.current) return;
      busy.current = true;
      setError('');
      try {
        await task();
      } catch (reason) {
        setError(skillConfirmationErrorText(reason));
        onFailure();
      } finally {
        busy.current = false;
      }
    },
    [setError],
  );
}

/** The quiz path of one skill: level → generation → answers → result → apply. */
export function useSkillQuizFlow(skillName: string, onApplied: () => void) {
  const [phase, setPhase] = useState<SkillQuizPhase>({ kind: 'level' });
  const [answers, setAnswers] = useState<Readonly<Record<string, number>>>({});
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const applyKey = useRef<string>();
  const guarded = useGuardedRequest(setError);

  const start = useCallback(
    (level: SkillQuizLevel) =>
      guarded(
        async () => {
          setPhase({ kind: 'generating' });
          const quiz = await generateSkillQuiz({ skillName, level });
          setAnswers({});
          setPhase({ kind: 'questions', quiz });
        },
        () => setPhase({ kind: 'level' }),
      ),
    [guarded, skillName],
  );

  const answer = useCallback((questionId: string, optionIndex: number) => {
    setAnswers((current) => ({ ...current, [questionId]: optionIndex }));
  }, []);

  const submit = useCallback(async () => {
    if (phase.kind !== 'questions') return;
    const quiz = phase.quiz;
    await guarded(
      async () => {
        setPhase({ kind: 'submitting', quiz });
        const submitted = await submitSkillQuiz({ attemptId: quiz.attemptId, answers });
        setPhase({ kind: 'result', submitted });
      },
      () => setPhase({ kind: 'questions', quiz }),
    );
  }, [guarded, phase, answers]);

  const apply = useCallback(async () => {
    if (phase.kind !== 'result') return;
    const submitted = phase.submitted;
    applyKey.current ??= crypto.randomUUID();
    const idempotencyKey = applyKey.current;
    setApplying(true);
    await guarded(async () => {
      await applySkillQuizAttempt({ attemptId: submitted.attemptId, idempotencyKey });
      setPhase({ kind: 'applied', submitted });
      onApplied();
    });
    setApplying(false);
  }, [guarded, phase, onApplied]);

  return { phase, answers, error, applying, start, answer, submit, apply };
}
