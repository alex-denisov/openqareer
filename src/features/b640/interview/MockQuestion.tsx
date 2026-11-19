import { useRef, useState } from 'react';
import type { ApplicationView } from '../../../../server/domain/applicationDerivedFields';
import { apiErrorMessage } from '../../coach/apiClient';
import {
  submitInterviewAnswer,
  transitionInterviewSession,
  type InterviewQuestionView,
  type InterviewSessionView,
} from '../../interview/interviewSimulatorApi';
import { Button, Icon, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { criteriaRows, mockEyebrow } from './model/mockModel';

interface QuestionProps {
  readonly response: ApplicationView;
  readonly session: InterviewSessionView;
  readonly question: InterviewQuestionView;
  readonly onSession: (next: InterviewSessionView) => void;
}

function Criteria({ question }: { readonly question: InterviewQuestionView }) {
  if (!question.answer) return null;
  return (
    <ul className="rows exp-rows mi-crit">
      {criteriaRows(question.answer.evaluation).map((row) => (
        <li className="row" key={row.key}>
          <div>
            <div className="row-title">{row.title}</div>
            <div className="row-sub">{row.sub}</div>
          </div>
          <span className={row.ok ? 'tag ok' : 'tag part'}>{row.tag}</span>
        </li>
      ))}
    </ul>
  );
}

/** Действия вопроса: ответить, следующий, ответить ещё раз, закончить. */
function useQuestionActions(props: QuestionProps) {
  const { navigate } = useShell();
  const [busy, setBusy] = useState<'answer' | 'move' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  async function run(kind: 'answer' | 'move', action: () => Promise<InterviewSessionView>) {
    setBusy(kind);
    setError(null);
    try {
      props.onSession(await action());
      return true;
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не получилось. Попробуйте ещё раз.'));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const { session, question } = props;
  return {
    busy,
    error,
    answer: (text: string, again: boolean) =>
      run('answer', () =>
        submitInterviewAnswer(session.id, {
          expectedVersion: session.version,
          questionId: question.id,
          answer: text.trim(),
          elapsedSeconds: Math.max(1, Math.round((Date.now() - shownAt.current) / 1000)),
          replaceAnswer: again,
        }),
      ),
    next: () => run('move', () => transitionInterviewSession(session.id, session.version, 'next')),
    finish: async () => {
      const done =
        session.status === 'completed' ||
        (await run('move', () =>
          transitionInterviewSession(session.id, session.version, 'finish'),
        ));
      if (done) navigate(buildNodePath('i01', { responseId: props.response.id }));
    },
  };
}

function Actions(props: {
  readonly answered: boolean;
  readonly last: boolean;
  readonly busy: boolean;
  readonly onAnswer: () => void;
  readonly onNext: () => void;
  readonly onAgain: () => void;
  readonly onFinish: () => void;
}) {
  return (
    <div className="actions m-commit">
      {props.answered && !props.last ? (
        <Button variant="primary" disabled={props.busy} onClick={props.onNext}>
          <Icon name="right" />
          Следующий вопрос
        </Button>
      ) : null}
      {props.answered ? null : (
        <Button variant="primary" disabled={props.busy} onClick={props.onAnswer}>
          <Icon name="send" />
          Ответить
        </Button>
      )}
      {props.answered ? (
        <Button variant="quiet" disabled={props.busy} onClick={props.onAgain}>
          <Icon name="repeat" />
          Ответить ещё раз
        </Button>
      ) : null}
      <Button disabled={props.busy} onClick={props.onFinish}>
        <Icon name="check" />
        Закончить
      </Button>
    </div>
  );
}

function AnswerField(props: {
  readonly text: string;
  readonly readOnly: boolean;
  readonly empty: boolean;
  readonly onChange: (text: string) => void;
}) {
  return (
    <div className="field mi-ans">
      <label htmlFor="mi-ans">Ваш ответ</label>
      <div className="fld-mic mi-fld">
        <textarea
          id="mi-ans"
          value={props.text}
          readOnly={props.readOnly}
          placeholder="Напишите ответ своими словами"
          aria-invalid={props.empty ? true : undefined}
          aria-describedby={props.empty ? 'mi-ans-err' : undefined}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      </div>
      {props.empty ? (
        <small className="is-err" id="mi-ans-err">
          <Icon name="warn" />
          Напишите ответ
        </small>
      ) : null}
    </div>
  );
}

/** Вопрос пробного интервью (I2): ответ текстом, разбор по критериям на месте. */
export function MockQuestion(props: QuestionProps) {
  const { session, question } = props;
  const [text, setText] = useState(question.answer?.text ?? '');
  const [again, setAgain] = useState(false);
  const [empty, setEmpty] = useState(false);
  const actions = useQuestionActions(props);
  const answered = Boolean(question.answer) && !again;
  async function answer() {
    setEmpty(!text.trim());
    if (text.trim() && (await actions.answer(text, again))) setAgain(false);
  }
  return (
    <section className="lead mi-lead" aria-labelledby="mi-title">
      <div className="eyebrow">
        <Icon name="play" />
        {mockEyebrow(
          props.response.vacancy?.company,
          session.currentQuestionIndex,
          session.questions.length,
        )}
      </div>
      <h2 className="mod-title" id="mi-title">
        «{question.prompt}»
      </h2>
      <AnswerField text={text} readOnly={answered} empty={empty} onChange={setText} />
      {actions.busy === 'answer' ? (
        <p className="ls-state" role="status">
          <span>Разбираем ответ…</span>
        </p>
      ) : null}
      {answered ? <Criteria question={question} /> : null}
      {actions.error ? <StatusLine state="err" text={actions.error} /> : null}
      <Actions
        answered={answered}
        last={session.currentQuestionIndex >= session.questions.length - 1}
        busy={actions.busy !== null}
        onAnswer={() => void answer()}
        onNext={() => void actions.next()}
        onAgain={() => setAgain(true)}
        onFinish={() => void actions.finish()}
      />
    </section>
  );
}
