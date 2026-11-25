import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import type { InterviewSessionView } from '../../interview/interviewSimulatorApi';
import { Button, Icon, StatusLine } from '../kit';
import { useVoiceInput } from '../voice/useVoiceInput';
import { isSessionGone } from './data/mockApi';
import { finishPractice, type PracticeTask } from './data/practiceApi';
import {
  liveCriteria,
  minutesLabel,
  minutesLeft,
  schemaBlocks,
  schemaToSave,
  type SchemaEdit,
  type SchemaToSave,
} from './model/practiceModel';
import { ANSWER_MAX, TextInput, useFinishAfterVoice, VoiceAnswer } from './PracticeAnswerInput';
import { SchemaEditor } from './SchemaEditor';

const TICK_MS = 15_000;

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Criteria({ answer, task }: { readonly answer: string; readonly task: PracticeTask }) {
  return (
    <>
      <h3 className="mod-title">Критерии</h3>
      <ul className="rows exp-rows">
        {liveCriteria(answer, task.caseKind).map((row) => (
          <li className="row" key={row.key}>
            <div>
              <div className="row-title">{row.title}</div>
              <div className="row-sub">{row.sub}</div>
            </div>
            <span className={row.ok ? 'tag ok' : 'tag part'}>{row.tag}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * B780: тренировку заменили в другой вкладке — `onLost` отдаёт набранный ответ экрану, он
 * перечитывает текущую и возвращает ответ в поле (`draft`); `onFinished` — ответ записан.
 */
export interface PracticeRecovery {
  readonly draft: string | undefined;
  readonly onLost: (text: string) => void;
  readonly onFinished: (session: InterviewSessionView) => void;
}

/** «Закончить и разобрать»: пустой ответ — ошибка поля, иначе ответ, схема и конец тренировки. */
function useFinish(input: {
  readonly session: InterviewSessionView;
  readonly questionId: string | null;
  readonly text: string;
  readonly schema: SchemaToSave | null;
  readonly onFinished: (session: InterviewSessionView) => void;
  readonly onLost: (text: string) => void;
}) {
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function finish() {
    const { session, questionId, text } = input;
    setEmpty(!text.trim());
    if (!questionId || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const done = await finishPractice({
        session,
        questionId,
        answer: text.slice(0, ANSWER_MAX),
        elapsedSeconds: Math.max(
          1,
          Math.round((Date.now() - Date.parse(session.startedAt)) / 1000),
        ),
        schema: input.schema,
      });
      input.onFinished(done);
    } catch (reason) {
      // B780: тренировку заменили в другой вкладке — экран подхватит текущую, ответ останется.
      if (isSessionGone(reason)) return input.onLost(text);
      setError(apiErrorMessage(reason, 'Не получилось сохранить ответ. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }
  return { empty: empty && !input.text.trim(), busy, error, finish };
}

/** Голосом — общий ввод i02/i03; «Закончить» во время записи ждёт расшифровку. */
function useSpokenFinish(
  spoken: boolean,
  onText: (text: string) => void,
  finish: () => Promise<void>,
) {
  const input = useVoiceInput(onText);
  const voice = spoken ? input : null;
  return { voice, after: useFinishAfterVoice(voice, () => void finish()) };
}

/** I3b: ответ, подсказка по желанию, схема и критерии по мере ответа. */
export function PracticeAnswer(props: {
  readonly task: PracticeTask;
  readonly company: string | null;
  readonly session: InterviewSessionView;
  readonly recovery: PracticeRecovery;
}) {
  const { task, session, recovery } = props;
  const question = session.currentQuestion ?? session.questions[0] ?? null;
  const [text, setText] = useState(question?.answer?.text ?? recovery.draft ?? '');
  const [edits, setEdits] = useState<readonly SchemaEdit[]>([]);
  const [hint, setHint] = useState(false);
  const now = useNow();
  const blocks = useMemo(() => schemaBlocks(text, edits), [text, edits]);
  const left = minutesLeft(session.startedAt, task.timeLimitMinutes, now);
  const { empty, busy, error, finish } = useFinish({
    session,
    questionId: question?.id ?? null,
    text,
    schema: edits.length > 0 ? schemaToSave(text, blocks) : null,
    ...recovery,
  });
  const { voice, after } = useSpokenFinish(session.mode === 'voice', setText, finish);

  return (
    <section className="lead" aria-labelledby="sd-title">
      <h2 className="lead-title is-long" id="sd-title">
        {task.title}
      </h2>
      <p className="lead-sub">{[props.company, minutesLabel(left)].filter(Boolean).join(' · ')}</p>
      {voice ? (
        <VoiceAnswer text={text} empty={empty} voice={voice} onText={setText} />
      ) : (
        <TextInput text={text} empty={empty} onText={setText} />
      )}
      <div className="actions">
        <Button variant="primary" busy={busy || after.waiting} onClick={after.request}>
          <Icon name="check" />
          Закончить и разобрать
        </Button>
        <Button variant="quiet" aria-expanded={hint} onClick={() => setHint((shown) => !shown)}>
          <Icon name="question" />
          Подсказка
        </Button>
      </div>
      {hint ? <p className="row-sub">{task.hint}</p> : null}
      {error ? <StatusLine state="err" text={error} /> : null}
      <SchemaEditor blocks={blocks} onEdit={(edit) => setEdits((list) => [...list, edit])} />
      <Criteria answer={text} task={task} />
    </section>
  );
}
