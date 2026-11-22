import { useEffect, useMemo, useRef, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import type { InterviewSessionView } from '../../interview/interviewSimulatorApi';
import { useDictation } from '../consultant/useDictation';
import { Button, Icon, StatusLine } from '../kit';
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
import { SchemaEditor } from './SchemaEditor';

const ANSWER_MAX = 4000;
const TICK_MS = 15_000;

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Criteria({ answer }: { readonly answer: string }) {
  return (
    <>
      <h3 className="mod-title">Критерии</h3>
      <ul className="rows exp-rows">
        {liveCriteria(answer).map((row) => (
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

interface InputProps {
  readonly text: string;
  readonly empty: boolean;
  readonly onText: (text: string) => void;
}

function TextInput(props: InputProps) {
  return (
    <div className="field">
      <textarea
        className="letter full sd-live"
        aria-label="Ваш ответ"
        value={props.text}
        maxLength={ANSWER_MAX}
        aria-invalid={props.empty ? true : undefined}
        aria-describedby={props.empty ? 'sd-ans-err' : undefined}
        onChange={(event) => props.onText(event.currentTarget.value)}
      />
      {props.empty ? (
        <small className="is-err" id="sd-ans-err">
          <Icon name="warn" />
          Напишите ответ
        </small>
      ) : null}
    </div>
  );
}

/** Голосом — расшифровка по мере речи; без микрофона — поле ответа. */
function VoiceInput(props: InputProps) {
  const dictation = useDictation(props.onText);
  const listening = dictation.supported && !dictation.denied;
  const { start } = dictation;
  const started = useRef(false);
  const first = useRef(props.text);
  useEffect(() => {
    if (!listening || started.current) return;
    started.current = true;
    start(first.current);
  }, [listening, start]);
  if (!listening) return <TextInput {...props} />;
  return (
    <div
      className="letter full sd-live"
      aria-live="polite"
      aria-label="Ваш ответ, расшифровка по мере речи"
    >
      <div>
        {props.text}
        {dictation.recording ? <span className="sd-caret" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}

/** «Закончить и разобрать»: пустой ответ — ошибка поля, иначе ответ, схема и конец тренировки. */
function useFinish(input: {
  readonly session: InterviewSessionView;
  readonly questionId: string | null;
  readonly text: string;
  readonly schema: SchemaToSave | null;
  readonly onFinished: (session: InterviewSessionView) => void;
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
      setError(apiErrorMessage(reason, 'Не получилось сохранить ответ. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }
  return { empty, busy, error, finish };
}

/** I3b: ответ, подсказка по желанию, схема и критерии по мере ответа. */
export function PracticeAnswer(props: {
  readonly task: PracticeTask;
  readonly company: string | null;
  readonly session: InterviewSessionView;
  readonly onFinished: (session: InterviewSessionView) => void;
}) {
  const { task, session } = props;
  const question = session.currentQuestion ?? session.questions[0] ?? null;
  const [text, setText] = useState(question?.answer?.text ?? '');
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
    onFinished: props.onFinished,
  });

  return (
    <section className="lead" aria-labelledby="sd-title">
      <h2 className="lead-title is-long" id="sd-title">
        {task.title}
      </h2>
      <p className="lead-sub">{[props.company, minutesLabel(left)].filter(Boolean).join(' · ')}</p>
      {session.mode === 'voice' ? (
        <VoiceInput text={text} empty={empty} onText={setText} />
      ) : (
        <TextInput text={text} empty={empty} onText={setText} />
      )}
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void finish()}>
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
      <Criteria answer={text} />
    </section>
  );
}
