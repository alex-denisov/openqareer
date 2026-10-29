import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { InterviewAnswerMode, InterviewQuestionType } from './interviewSimulatorApi';
import type { MockInterviewQuestionScope, MockInterviewScreen } from './mockInterviewControllerTypes';
import type { MockInterviewSessionState } from './useMockInterviewSession';
import type { SpeechTranscription } from './useSpeechTranscription';

interface SetupActionOptions {
  readonly model: MockInterviewSessionState;
  readonly mode: InterviewAnswerMode;
  readonly roleTitle: string;
  readonly questionScope: MockInterviewQuestionScope;
  readonly stressMode: boolean;
  readonly setScreen: Dispatch<SetStateAction<MockInterviewScreen>>;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly answerStartedAt: MutableRefObject<number>;
}

export function useMockInterviewSetupActions(options: SetupActionOptions) {
  const start = useCallback(async () => {
    options.setScreen('preparing');
    const result = await options.model.startTraining({
      mode: options.mode,
      roleTitle: options.roleTitle,
      questionTypes: questionTypesForScope(options.questionScope),
      stressMode: options.stressMode,
    });
    if (result.session) {
      options.answerStartedAt.current = Date.now();
      options.setDraft('');
      options.setScreen(options.mode === 'voice' ? 'voice' : 'question');
    } else {
      options.setScreen(isTariffLimit(result.error?.code) ? 'paywall' : 'setup');
    }
    return result;
  }, [options]);

  const resume = useCallback(async () => {
    const existing = options.model.session;
    if (!existing) return null;
    const result = existing.status === 'active'
      ? { session: existing, error: null }
      : await options.model.transition('resume');
    if (!result.session) return null;
    const answer = result.session.questions[result.session.currentQuestionIndex]?.answer?.text ?? '';
    options.answerStartedAt.current = Date.now();
    options.setDraft(answer);
    options.setScreen(answer ? 'review' : (existing.mode === 'voice' ? 'voice' : 'question'));
    return result.session;
  }, [options]);

  return { start, resume };
}

interface QuestionActionOptions {
  readonly model: MockInterviewSessionState;
  readonly speech: SpeechTranscription;
  readonly currentQuestionAnswer: string;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly setScreen: Dispatch<SetStateAction<MockInterviewScreen>>;
  readonly answerStartedAt: MutableRefObject<number>;
}

export function useMockInterviewAnswerActions(options: QuestionActionOptions) {
  const answerElapsedSeconds = useCallback(() => Math.min(
    3_600,
    Math.max(0, Math.floor((Date.now() - options.answerStartedAt.current) / 1_000)),
  ), [options.answerStartedAt]);

  const submitAnswer = useCallback(async (answer: string, elapsedSeconds = answerElapsedSeconds()) => {
    const result = await options.model.saveAnswer(answer, elapsedSeconds);
    if (result.session) {
      options.setDraft(answer);
      options.setScreen('review');
      options.speech.stop();
    }
    return result;
  }, [answerElapsedSeconds, options]);

  const startVoice = useCallback(() => {
    options.setScreen('voice');
    options.speech.reset();
    options.answerStartedAt.current = Date.now();
    options.speech.start();
  }, [options]);

  const switchToText = useCallback(() => {
    const transcript = options.speech.transcript;
    options.speech.stop();
    options.setDraft(transcript);
    options.setScreen('question');
  }, [options]);

  const tryAgain = useCallback(() => {
    if (options.currentQuestionAnswer) options.setDraft(options.currentQuestionAnswer);
    options.answerStartedAt.current = Date.now();
    options.speech.reset();
    options.setScreen('question');
    options.model.clearError();
  }, [options]);

  return { answerElapsedSeconds, submitAnswer, startVoice, switchToText, tryAgain };
}

interface ProgressActionOptions {
  readonly model: MockInterviewSessionState;
  readonly speech: SpeechTranscription;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly setScreen: Dispatch<SetStateAction<MockInterviewScreen>>;
  readonly markCurrentQuestion: (answerText?: string) => void;
}

export function useMockInterviewProgressActions(options: ProgressActionOptions) {
  const stop = useCallback(async () => {
    options.speech.stop();
    const result = await options.model.stopTraining();
    if (result.session) options.setScreen('interrupted');
    return result.session;
  }, [options]);

  const advance = useCallback(async (action: 'next' | 'skip') => {
    options.speech.reset();
    const result = await options.model.transition(action);
    if (!result.session) return null;
    options.setDraft('');
    if (result.session.status === 'completed') options.setScreen('result');
    else options.markCurrentQuestion();
    return result.session;
  }, [options]);

  return { stop, advance };
}

interface ExitActionOptions {
  readonly model: MockInterviewSessionState;
  readonly speech: SpeechTranscription;
  readonly currentQuestionAnswer: string;
  readonly screen: MockInterviewScreen;
  readonly draft: string;
  readonly exitConfirmation: boolean;
  readonly setExitConfirmation: Dispatch<SetStateAction<boolean>>;
  readonly setScreen: Dispatch<SetStateAction<MockInterviewScreen>>;
  readonly onBackToPreparation: () => void;
}

export function useMockInterviewExitActions(options: ExitActionOptions) {
  const returnToPreparation = useCallback(() => {
    if (options.exitConfirmation) {
      options.setExitConfirmation(false);
      return;
    }
    const hasUnsentText = ['question', 'voice'].includes(options.screen) && (
      options.speech.state === 'recording' ||
      (options.draft.trim() && options.draft !== options.currentQuestionAnswer) ||
      (options.speech.transcript.trim() && options.speech.transcript !== options.currentQuestionAnswer)
    );
    if (hasUnsentText) {
      options.speech.stop();
      options.setExitConfirmation(true);
      return;
    }
    options.speech.stop();
    options.onBackToPreparation();
  }, [options]);

  const confirmReturnToPreparation = useCallback(() => {
    options.speech.stop();
    options.setExitConfirmation(false);
    options.onBackToPreparation();
  }, [options]);

  const refreshSession = useCallback(() => {
    options.model.clearError();
    options.setScreen('setup');
    options.model.retryLoad();
  }, [options]);

  return { returnToPreparation, confirmReturnToPreparation, refreshSession };
}

function questionTypesForScope(scope: MockInterviewQuestionScope): readonly InterviewQuestionType[] {
  if (scope === 'behavioral') return ['behavioral'];
  if (scope === 'system_design') return ['system_design'];
  return ['behavioral', 'system_design'];
}

/** B579: исчерпанная квота тренировок ведёт на тот же экран тарифа, что и Free. */
function isTariffLimit(code: string | undefined): boolean {
  return code === 'paywall_required' || code === 'quota_exhausted';
}
