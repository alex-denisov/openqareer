import { useCallback } from 'react';
import {
  startInterviewSession,
  submitInterviewAnswer,
  transitionInterviewSession,
  type InterviewSessionView,
} from './interviewSimulatorApi';
import type {
  InterviewSessionOperationResult,
  SessionOperationRunner,
  SessionStarter,
  SessionTransition,
} from './mockInterviewSessionTypes';

export interface InterviewSessionMutations {
  readonly startTraining: SessionStarter;
  readonly transition: SessionTransition;
  readonly stopTraining: () => Promise<InterviewSessionOperationResult>;
  readonly saveAnswer: (answer: string, elapsedSeconds: number) => Promise<InterviewSessionOperationResult>;
}

export function useInterviewSessionMutations(
  session: InterviewSessionView | null,
  run: SessionOperationRunner,
): InterviewSessionMutations {
  const startTraining = useStartTraining(session, run);
  const transition = useSessionTransition(session, run);
  const stopTraining = useStopTraining(session, run, transition);
  const saveAnswer = useSaveInterviewAnswer(session, run);
  return { startTraining, transition, stopTraining, saveAnswer };
}

function useStartTraining(session: InterviewSessionView | null, run: SessionOperationRunner): SessionStarter {
  return useCallback((input) => run(
    'start',
    () => startInterviewSession({
      ...input,
      replaceCompleted: Boolean(session && ['completed', 'interrupted'].includes(session.status)),
    }),
    'Тренировку не удалось начать.',
  ), [run, session]);
}

function useSessionTransition(session: InterviewSessionView | null, run: SessionOperationRunner): SessionTransition {
  return useCallback((action) => {
    if (!session) return Promise.resolve({ session: null, error: null });
    return run(
      'transition',
      () => transitionInterviewSession(session.id, session.version, action),
      'Тренировку не удалось обновить.',
    );
  }, [run, session]);
}

function useStopTraining(
  session: InterviewSessionView | null,
  run: SessionOperationRunner,
  transition: SessionTransition,
) {
  return useCallback(async () => {
    if (!session) return { session: null, error: null };
    if (session.status !== 'paused') return transition('interrupt');
    const resumed = await run(
      'transition',
      () => transitionInterviewSession(session.id, session.version, 'resume'),
      'Тренировку не удалось продолжить перед остановкой.',
    );
    if (!resumed.session) return resumed;
    return run(
      'transition',
      () => transitionInterviewSession(resumed.session!.id, resumed.session!.version, 'interrupt'),
      'Тренировку не удалось остановить.',
    );
  }, [run, session, transition]);
}

function useSaveInterviewAnswer(session: InterviewSessionView | null, run: SessionOperationRunner) {
  return useCallback((answer: string, elapsedSeconds: number) => {
    const question = session?.questions[session.currentQuestionIndex];
    if (!session || !question) return Promise.resolve({ session: null, error: null });
    return run(
      'answer',
      () => submitInterviewAnswer(session.id, {
        expectedVersion: session.version,
        questionId: question.id,
        answer,
        elapsedSeconds: Math.min(elapsedSeconds, 3_600),
        replaceAnswer: Boolean(question.answer),
      }),
      'Ответ не удалось сохранить и оценить.',
    );
  }, [run, session]);
}
