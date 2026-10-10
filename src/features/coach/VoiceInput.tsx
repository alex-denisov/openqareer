import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  ArrowsClockwise,
  Microphone,
  PaperPlaneTilt,
  PencilSimple,
  Spinner,
  Trash,
  Waveform,
  WarningCircle,
} from '@phosphor-icons/react';
import { VoiceInputController } from './voiceInputController';
import type { VoiceInputState } from './voiceInputMachine';
import './voice-input.css';

interface VoiceInputProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onStateChange: (state: VoiceInputState) => void;
  onVoiceDraftChange: (hasVoiceDraft: boolean) => void;
  onSubmitVoice: (value: string) => Promise<boolean>;
  onTextMode: () => void;
}

interface VoiceInputViewProps extends VoiceInputProps {
  state: VoiceInputState;
  elapsedSeconds: number;
  hasTranscript: boolean;
  showPermissionHelp: boolean;
  togglePermissionHelp: () => void;
  request: () => void;
  approve: () => void;
  cancel: () => void;
  restart: () => void;
  finish: () => void;
  useTextMode: () => void;
  submitVoice: () => void;
}

interface VoiceInputActions {
  request: () => void;
  approve: () => void;
  cancel: () => void;
  restart: () => void;
  finish: () => void;
  useTextMode: () => void;
  togglePermissionHelp: () => void;
  submitVoice: () => void;
}

export function VoiceInput(props: VoiceInputProps) {
  const view = useVoiceInput(props);
  if (view.state === 'idle' && props.value.trim()) return null;
  return <VoiceInputView {...props} {...view} />;
}

function useVoiceInput(props: VoiceInputProps): VoiceInputViewProps {
  const latestProps = useRef(props);
  latestProps.current = props;
  const [state, setState] = useState<VoiceInputState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);
  const [controller] = useState(() => createVoiceController(latestProps, setState, setElapsedSeconds, setHasTranscript));
  useVoiceControllerLifecycle(controller, props, state, hasTranscript);
  const actions = useVoiceInputActions(controller, latestProps, setShowPermissionHelp);

  return {
    ...props,
    state,
    elapsedSeconds,
    hasTranscript,
    showPermissionHelp,
    ...actions,
  };
}

function createVoiceController(
  latestProps: MutableRefObject<VoiceInputProps>,
  setState: (state: VoiceInputState) => void,
  setElapsedSeconds: (seconds: number) => void,
  setHasTranscript: (hasTranscript: boolean) => void,
): VoiceInputController {
  return new VoiceInputController({
    onState: (state) => {
      setState(state);
      latestProps.current.onStateChange(state);
    },
    onText: (value) => latestProps.current.onChange(value),
    onVoiceDraft: (hasTranscript) => {
      setHasTranscript(hasTranscript);
      latestProps.current.onVoiceDraftChange(hasTranscript);
    },
    onTextMode: () => latestProps.current.onTextMode(),
    onElapsedSeconds: setElapsedSeconds,
  });
}

function useVoiceControllerLifecycle(
  controller: VoiceInputController,
  props: VoiceInputProps,
  state: VoiceInputState,
  hasTranscript: boolean,
): void {
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (hasTranscript && !props.value.trim() && state !== 'recording') controller.cancel();
  }, [controller, hasTranscript, props.value, state]);
}

function useVoiceInputActions(
  controller: VoiceInputController,
  latestProps: React.MutableRefObject<VoiceInputProps>,
  setShowPermissionHelp: Dispatch<SetStateAction<boolean>>,
): VoiceInputActions {
  const request = useCallback(() => controller.request(), [controller]);
  const approve = useCallback(
    () => controller.approve(latestProps.current.value),
    [controller, latestProps],
  );
  const cancel = useCallback(() => controller.cancel(), [controller]);
  const restart = useCallback(() => controller.restart(), [controller]);
  const finish = useCallback(() => controller.finish(), [controller]);
  const useTextMode = useCallback(() => controller.useTextMode(), [controller]);
  const togglePermissionHelp = useCallback(
    () => setShowPermissionHelp((shown) => !shown),
    [setShowPermissionHelp],
  );
  const submitVoice = useCallback(() => {
    void submitVoiceText(controller, latestProps);
  }, [controller, latestProps]);
  return { request, approve, cancel, restart, finish, useTextMode, togglePermissionHelp, submitVoice };
}

async function submitVoiceText(
  controller: VoiceInputController,
  latestProps: MutableRefObject<VoiceInputProps>,
): Promise<void> {
  const current = latestProps.current;
  const clean = current.value.trim();
  if (clean && !current.disabled && (await current.onSubmitVoice(clean))) controller.sent();
}

function VoiceInputView(props: VoiceInputViewProps) {
  const { state } = props;
  return (
    <div className="career-voice-input" data-active={state !== 'idle'} data-status={state}>
      {state === 'idle' ? <VoiceTrigger disabled={props.disabled} onClick={props.request} /> : null}
      {state === 'consent' ? <ConsentPanel {...props} /> : null}
      {state === 'starting' || state === 'finishing' ? <LoadingPanel {...props} /> : null}
      {state === 'recording' ? <RecordingPanel {...props} /> : null}
      {state === 'transcribed' ? <TranscriptPanel {...props} /> : null}
      {state === 'denied' ? <DeniedPanel {...props} /> : null}
      {isVoiceFailure(state) ? <FailurePanel {...props} /> : null}
    </div>
  );
}

function VoiceTrigger({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="career-voice-trigger"
      aria-label="Голосовой ввод"
      title="Голосовой ввод"
      disabled={disabled}
      onClick={onClick}
    >
      <Microphone size="1em" aria-hidden="true" />
    </button>
  );
}

function ConsentPanel({ approve, cancel }: VoiceInputViewProps) {
  return (
    <section className="career-voice-panel" aria-label="Согласие на голосовой ввод">
      <p>Проверим, поддерживает ли браузер локальное распознавание. OpenQareer не получает аудиозапись.</p>
      <div className="career-voice-actions">
        <ActionButton primary onClick={approve}>Разрешить микрофон</ActionButton>
        <ActionButton onClick={cancel}>Отмена</ActionButton>
      </div>
    </section>
  );
}

function LoadingPanel({ state, cancel }: VoiceInputViewProps) {
  return (
    <section className="career-voice-panel" role="status" aria-live="polite" aria-busy="true">
      <p>
        <Spinner size="1em" aria-hidden="true" />
        {state === 'starting' ? 'Проверяем локальный модуль речи…' : 'Завершаем распознавание…'}
      </p>
      {state === 'starting' ? <ActionButton onClick={cancel}>Отмена</ActionButton> : null}
    </section>
  );
}

function RecordingPanel({ elapsedSeconds, cancel, restart, finish }: VoiceInputViewProps) {
  return (
    <section className="career-voice-panel" aria-label="Запись голоса">
      <div className="career-voice-status" role="status" aria-live="polite">
        <span className="career-voice-indicator" aria-hidden="true" />
        <strong>Идёт запись</strong>
        <time aria-label="Длительность записи">{formatElapsed(elapsedSeconds)}</time>
        <Waveform size="1em" aria-hidden="true" />
      </div>
      <p className="career-voice-caption">Текст распознаётся сразу. Максимум — 5 минут.</p>
      <div className="career-voice-actions">
        <ActionButton danger icon={<Trash size="1em" aria-hidden="true" />} onClick={cancel}>
          Отменить запись
        </ActionButton>
        <ActionButton icon={<ArrowsClockwise size="1em" aria-hidden="true" />} onClick={restart}>
          Записать снова
        </ActionButton>
        <ActionButton primary onClick={finish}>Закончить запись</ActionButton>
      </div>
    </section>
  );
}

function TranscriptPanel({ disabled, submitVoice, useTextMode, restart }: VoiceInputViewProps) {
  return (
    <section className="career-voice-panel" aria-label="Распознанный текст">
      <p role="status" aria-live="polite">Текст распознан. Проверьте его в поле ввода перед отправкой.</p>
      <div className="career-voice-actions">
        <ActionButton primary disabled={disabled} icon={<PaperPlaneTilt size="1em" aria-hidden="true" />} onClick={submitVoice}>
          Отправить голосом
        </ActionButton>
        <ActionButton icon={<PencilSimple size="1em" aria-hidden="true" />} onClick={useTextMode}>
          Ответить текстом
        </ActionButton>
        <ActionButton icon={<ArrowsClockwise size="1em" aria-hidden="true" />} onClick={restart}>
          Записать снова
        </ActionButton>
      </div>
    </section>
  );
}

function DeniedPanel(props: VoiceInputViewProps) {
  return (
    <section className="career-voice-panel" aria-label="Нет доступа к микрофону">
      <p role="alert">
        <WarningCircle size="1em" aria-hidden="true" /> Доступ к микрофону не разрешён. Можно ответить текстом.
      </p>
      <div className="career-voice-actions">
        <ActionButton ariaExpanded={props.showPermissionHelp} onClick={props.togglePermissionHelp}>
          Как разрешить
        </ActionButton>
        <ActionButton onClick={props.restart}>Записать снова</ActionButton>
        <ActionButton onClick={props.useTextMode}>Ответить текстом</ActionButton>
      </div>
      {props.showPermissionHelp ? <PermissionHelp /> : null}
    </section>
  );
}

function FailurePanel(props: VoiceInputViewProps) {
  const { state } = props;
  const message = failureMessage(state);
  return (
    <section className="career-voice-panel" aria-label="Голосовой ввод недоступен">
      <p role={state === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
      <div className="career-voice-actions">
        {state !== 'unsupported' ? <ActionButton onClick={props.restart}>Записать снова</ActionButton> : null}
        <ActionButton onClick={props.useTextMode}>Ответить текстом</ActionButton>
      </div>
    </section>
  );
}

function PermissionHelp() {
  return <p className="career-voice-help">В настройках браузера для этого сайта разрешите микрофон, затем начните запись снова.</p>;
}

function ActionButton({
  children,
  danger = false,
  disabled,
  icon,
  primary = false,
  ariaExpanded,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  primary?: boolean;
  ariaExpanded?: boolean;
  onClick: () => void;
}) {
  const variant = primary ? ' career-voice-button--primary' : danger ? ' career-voice-button--danger' : '';
  return (
    <button
      type="button"
      className={`career-voice-button${variant}`}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function isVoiceFailure(state: VoiceInputState): boolean {
  return state === 'unrecognized' || state === 'error' || state === 'unsupported';
}

function failureMessage(state: VoiceInputState): string {
  if (state === 'unrecognized') return 'Речь не распознана. Попробуйте ещё раз или ответьте текстом.';
  if (state === 'unsupported') return 'Локальное распознавание речи на русском в этом браузере недоступно. Ответьте текстом.';
  return 'Локальное распознавание не завершилось. Ответьте текстом или начните запись снова.';
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
