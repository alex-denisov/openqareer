import { useEscapeLayer } from '../shell/escapeLayers';
import { useMockInterviewController } from './useMockInterviewController';
import type { MockInterviewSimulatorProps } from './mockInterviewSimulatorTypes';
import { ResultScreen } from './MockInterviewResultScreen';
import {
  ExitConfirmation,
  InterruptedScreen,
  LoadErrorScreen,
  MockInterviewLoading,
  PaywallScreen,
} from './MockInterviewSupport';
import { QuestionScreen, ReviewScreen, VoiceScreen } from './MockInterviewQuestionScreens';
import { SetupScreen } from './MockInterviewSetupScreen';
import {
  DesktopSectionTitle,
  MobileStateHero,
  MockInterviewHeader,
  MockInterviewSessionHeader,
} from './MockInterviewHeaders';
import './mock-interview.css';
import './mock-interview-flow.css';
import './mock-interview-screen.css';

type Flow = ReturnType<typeof useMockInterviewController>;

export function MockInterviewSimulator(props: MockInterviewSimulatorProps) {
  const flow = useMockInterviewController(
    props.vacancy.title,
    props.onBackToPreparation,
    props.initialStressMode,
    props.vacancy.applicationId,
  );
  useEscapeLayer(flow.returnToPreparation, true);

  return (
    <div
      ref={props.dialogRef}
      className="career-mock-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="career-mock-title"
      tabIndex={-1}
      aria-busy={flow.loadState === 'loading' || flow.screen === 'preparing'}
    >
      <MockInterviewHeader screen={flow.screen} onBack={flow.returnToPreparation} onAskConsultant={props.onAskConsultant} />
      <DesktopSectionTitle screen={flow.screen} />
      <div className="career-mock-content">
        <MockInterviewSessionHeader vacancy={props.vacancy} flow={flow} onBack={flow.returnToPreparation} />
        <MobileStateHero flow={flow} />
        <MockInterviewContent flow={flow} props={props} />
      </div>
      {flow.exitConfirmation ? (
        <ExitConfirmation
          onStay={() => flow.setExitConfirmation(false)}
          onLeave={flow.confirmReturnToPreparation}
        />
      ) : null}
    </div>
  );
}

function MockInterviewContent({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  if (flow.loadState === 'loading') return <MockInterviewLoading label="Загружаем сохранённую тренировку" />;
  if (flow.loadState === 'error') return <LoadErrorScreen flow={flow} />;
  if (flow.screen === 'preparing') return <MockInterviewLoading label="Вопрос готовится" />;
  if (flow.screen === 'paywall') return <PaywallScreen onBack={props.onBackToPreparation} />;
  if (flow.screen === 'question') return <QuestionScreen flow={flow} props={props} />;
  if (flow.screen === 'voice') return <VoiceScreen flow={flow} props={props} />;
  if (flow.screen === 'review') return <ReviewScreen flow={flow} props={props} />;
  if (flow.screen === 'interrupted') return <InterruptedScreen flow={flow} props={props} />;
  if (flow.screen === 'result' && flow.session) return <ResultScreen flow={flow} props={props} />;
  return <SetupScreen flow={flow} props={props} />;
}

