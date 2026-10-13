import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterviewAnswerMode } from './interviewSimulatorApi';
import { useMockInterviewSession } from './useMockInterviewSession';
import { useSpeechTranscription } from './useSpeechTranscription';
import {
  useMockInterviewAnswerActions,
  useMockInterviewExitActions,
  useMockInterviewProgressActions,
  useMockInterviewSetupActions,
} from './useMockInterviewControllerActions';
import type { MockInterviewQuestionScope, MockInterviewScreen } from './mockInterviewControllerTypes';

export type { MockInterviewQuestionScope, MockInterviewScreen } from './mockInterviewControllerTypes';

export function useMockInterviewController(roleTitle: string, onBackToPreparation: () => void) {
  const model = useMockInterviewSession();
  const speech = useSpeechTranscription();
  const [screen, setScreen] = useState<MockInterviewScreen>('setup');
  const [mode, setMode] = useState<InterviewAnswerMode>('text');
  const [questionScope, setQuestionScope] = useState<MockInterviewQuestionScope>('both');
  const [stressMode, setStressMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const answerStartedAt = useRef(Date.now());
  const currentQuestion = model.session?.questions[model.session.currentQuestionIndex] ?? null;

  useEffect(() => {
    if (model.loadState === 'ready' && model.session?.status === 'completed') setScreen('result');
  }, [model.loadState, model.session?.status]);

  const markCurrentQuestion = useCallback((answerText = '') => {
    answerStartedAt.current = Date.now();
    setDraft(answerText);
    setScreen((model.session?.mode ?? mode) === 'voice' ? 'voice' : 'question');
  }, [mode, model.session?.mode]);
  const currentQuestionAnswer = currentQuestion?.answer?.text ?? '';
  const setupActions = useMockInterviewSetupActions({
    model, mode, roleTitle, questionScope, stressMode, setScreen, setDraft, answerStartedAt,
  });
  const answerActions = useMockInterviewAnswerActions({
    model, speech, currentQuestionAnswer, setDraft, setScreen, answerStartedAt,
  });
  const progressActions = useMockInterviewProgressActions({ model, speech, setDraft, setScreen, markCurrentQuestion });
  const exitActions = useMockInterviewExitActions({
    model, speech, currentQuestionAnswer, screen, draft, exitConfirmation, setExitConfirmation, setScreen, onBackToPreparation,
  });

  return {
    ...model, speech, screen, setScreen, mode, setMode, questionScope, setQuestionScope,
    stressMode, setStressMode, draft, setDraft, currentQuestion, answerStartedAt,
    exitConfirmation, setExitConfirmation, ...setupActions, ...answerActions,
    ...exitActions, stop: progressActions.stop,
    next: () => progressActions.advance('next'), skip: () => progressActions.advance('skip'),
  };
}

export type MockInterviewFlow = ReturnType<typeof useMockInterviewController>;
