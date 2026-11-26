import { useEffect, useState } from 'react';
import type {
  StatusSignal,
  StatusSignalAnswer,
  StatusSignalState,
} from '../../../../shared/statusSignal';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Icon, InfoTip, ResultLine, StatusLine, type IconName } from '../kit';
import { useShell } from '../shell/ShellContext';
import {
  answerStatusSignal,
  getStatusSignal,
  signalStatusPath,
  undoStatusSignalAnswer,
} from './signalApi';
import { useLoad } from './useLoad';

const ANSWERS: readonly (readonly [StatusSignalAnswer, string, IconName])[] = [
  ['yes', 'Верно', 'check'],
  ['no', 'Нет', 'close'],
  ['later', 'Не сейчас', 'clock'],
];

interface SignalCardProps {
  readonly signal: StatusSignal;
  readonly busy: StatusSignalAnswer | null;
  readonly onAnswer: (answer: StatusSignalAnswer) => void;
}

function SignalCard({ signal, busy, onAnswer }: SignalCardProps) {
  const { before, accent, after } = signal.question;
  return (
    <div className="why-body">
      <p className="why-q">
        <Icon name="target" />
        <span>
          {before}
          <strong>{accent}</strong>
          {after}
        </span>
        <InfoTip label="Почему мы так думаем" text={signal.facts.join(' · ')} />
      </p>
      <div className="actions">
        {ANSWERS.map(([answer, label, icon]) => (
          <Button
            key={answer}
            size="sm"
            variant={answer === 'yes' ? 'default' : 'quiet'}
            icon={icon}
            busy={busy === answer}
            disabled={busy !== null}
            onClick={() => onAnswer(answer)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Прочитанный сигнал; после ответа — то, что вернул сервер. */
function useSignalState(): [StatusSignalState | null, (next: StatusSignalState) => void] {
  const loaded = useLoad(getStatusSignal);
  const [local, setLocal] = useState<StatusSignalState | null>(null);
  return [local ?? (loaded.state === 'ready' ? loaded.data : null), setLocal];
}

/** Сообщает экрану, показан ли вопрос: от этого зависит кнопка ведущего блока на 390. */
function useReportShown(shown: boolean, onShown?: (shown: boolean) => void): void {
  useEffect(() => {
    onShown?.(shown);
  }, [onShown, shown]);
}

export interface StatusSignalBlockProps {
  /** Нынешний статус: его называет строка после «Нет». */
  readonly statusTitle: string;
  /** Блок во всю ширину над колонками (макет s04) или в правой колонке (s05b). */
  readonly wide: boolean;
  /** Показан ли сейчас вопрос с ответами. */
  readonly onShown?: (shown: boolean) => void;
}

/**
 * Сигнал «похоже, вы начали искать» или «хотите сменить профессию».
 * «Верно» ведёт к выбору статуса, «Нет» и «Не сейчас» убирают вопрос;
 * ответ «Нет» можно отменить до конца дня. Статус сигнал не меняет.
 */
export function StatusSignalBlock({ statusTitle, wide, onShown }: StatusSignalBlockProps) {
  const { navigate } = useShell();
  const [state, setLocal] = useSignalState();
  const [busy, setBusy] = useState<StatusSignalAnswer | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(step: StatusSignalAnswer | 'undo', signal: StatusSignal | null) {
    if (busy) return;
    setBusy(step);
    setError(null);
    try {
      const next =
        step === 'undo' || !signal
          ? await undoStatusSignalAnswer()
          : await answerStatusSignal(signal.kind, step);
      setLocal(next);
      if (step === 'yes' && signal) navigate(signalStatusPath(signal.suggest));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить ответ. Нажмите ещё раз.'));
      // Вопрос мог устареть (ответили в другой вкладке): показываем, что есть сейчас.
      void getStatusSignal().then(setLocal, () => undefined);
    } finally {
      setBusy(null);
    }
  }

  useReportShown(Boolean(state?.signal), onShown);
  // «Нет» можно отменить до конца дня, даже если уже показан другой вопрос.
  const refused = state?.answered?.answer === 'no';
  if (!state || (!state.signal && !refused)) return null;
  return (
    <section
      className={wide ? 'route why col-wide' : 'route why'}
      aria-label="Предложение сменить статус"
    >
      {state.signal ? (
        <SignalCard
          signal={state.signal}
          busy={busy === 'undo' ? null : busy}
          onAnswer={(answer) => void run(answer, state.signal)}
        />
      ) : null}
      {refused ? (
        <ResultLine
          text={`Хорошо, оставляем «${statusTitle}»`}
          undoLabel="Отменить ответ"
          onUndo={() => void run('undo', null)}
        />
      ) : null}
      {error ? <StatusLine state="err" text={error} /> : null}
    </section>
  );
}
