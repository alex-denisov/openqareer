import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import type { InterviewSessionView } from '../../interview/interviewSimulatorApi';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import {
  markHelpful,
  reviewPractice,
  saveSchema,
  type PracticeReview as Review,
} from './data/practiceApi';
import {
  blockCountTitle,
  reviewRows,
  reviewTitle,
  schemaBlocks,
  schemaToSave,
  type SchemaBlock,
} from './model/practiceModel';
import { SchemaView } from './SchemaEditor';

function Rows({ review }: { readonly review: Review }) {
  return (
    <ul className="rows exp-rows">
      {reviewRows(review.evaluation).map((row) => (
        <li className="row" key={row.key}>
          <div>
            <div className="row-title">{row.title}</div>
            <div className="row-sub">{row.sub}</div>
            {row.quote ? <div className="row-sub">{row.quote}</div> : null}
          </div>
          <span className={row.ok ? 'tag ok' : 'tag part'}>{row.tag}</span>
        </li>
      ))}
    </ul>
  );
}

function SaveSchema(props: {
  readonly sessionId: string;
  readonly questionId: string;
  readonly answer: string;
  readonly blocks: readonly SchemaBlock[];
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  async function save() {
    setState('busy');
    try {
      await saveSchema(props.sessionId, props.questionId, schemaToSave(props.answer, props.blocks));
      setState('ok');
    } catch {
      setState('err');
    }
  }
  return (
    <>
      <div className="actions m-commit">
        <Button
          variant="primary"
          busy={state === 'busy'}
          disabled={props.blocks.length === 0}
          onClick={() => void save()}
        >
          <Icon name="bookmark" />
          Сохранить схему в подготовку
        </Button>
      </div>
      {state === 'ok' ? <StatusLine state="ok" text="Схема сохранена в подготовку." /> : null}
      {state === 'err' ? (
        <StatusLine state="err" text="Не получилось сохранить схему. Попробуйте ещё раз." />
      ) : null}
    </>
  );
}

function Vote(props: {
  readonly sessionId: string;
  readonly questionId: string;
  readonly initial: boolean | null;
}) {
  const [helpful, setHelpful] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  async function vote(value: boolean) {
    setError(null);
    try {
      setHelpful(await markHelpful(props.sessionId, props.questionId, value));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Ответ не сохранился. Попробуйте ещё раз.'));
    }
  }
  return (
    <>
      <div className="sd-vote" role="group" aria-label="Разбор помог?">
        <span>Разбор помог?</span>
        <Button variant="quiet" aria-pressed={helpful === true} onClick={() => void vote(true)}>
          Да
        </Button>
        <Button variant="quiet" aria-pressed={helpful === false} onClick={() => void vote(false)}>
          Нет
        </Button>
      </div>
      {error ? <StatusLine state="err" text={error} /> : null}
    </>
  );
}

function blocksOf(review: Review, answer: string): SchemaBlock[] {
  const saved = review.schema?.schema?.nodes;
  return saved && saved.length > 0
    ? saved.map(({ id, label }) => ({ id, label }))
    : schemaBlocks(answer, []);
}

function SchemaColumn({ blocks }: { readonly blocks: readonly SchemaBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="sc-map">
      <div className="eyebrow">Схема из вашего ответа</div>
      <h3 className="mod-title" id="sc-map">
        {blockCountTitle(blocks.length)}
      </h3>
      <SchemaView blocks={blocks} />
    </section>
  );
}

function ReviewBody(props: {
  readonly review: Review;
  readonly session: InterviewSessionView;
  readonly answer: string;
  readonly company: string | null;
  readonly responseId: string;
}) {
  const { review, session } = props;
  const blocks = blocksOf(review, props.answer);
  return (
    <>
      <div className="col">
        <section className="lead" aria-labelledby="sc-title">
          <h2 className="lead-title is-long" id="sc-title">
            {reviewTitle(review.evaluation)}
          </h2>
          {props.company ? <p className="lead-sub">{props.company}</p> : null}
          <Rows review={review} />
          {review.exampleAnswer ? (
            <details className="sd-strong">
              <summary>
                <Icon name="down" />
                Пример сильного ответа
              </summary>
              <p>{review.exampleAnswer}</p>
            </details>
          ) : null}
          <SaveSchema
            sessionId={session.id}
            questionId={review.questionId}
            answer={props.answer}
            blocks={blocks}
          />
          <Link className="row-act" to={buildNodePath('i01', { responseId: props.responseId })}>
            <Icon name="file" />
            Открыть памятку
          </Link>
          <Vote sessionId={session.id} questionId={review.questionId} initial={review.helpful} />
        </section>
      </div>
      <div className="col">
        <SchemaColumn blocks={blocks} />
      </div>
    </>
  );
}

/** I3c: разбор по четырём критериям, пример сильного ответа и схема. */
export function PracticeReview(props: {
  readonly session: InterviewSessionView;
  readonly company: string | null;
  readonly responseId: string;
}) {
  const question = props.session.questions[0];
  const sessionId = props.session.id;
  const questionId = question?.id ?? '';
  const load = useCallback(() => reviewPractice(sessionId, questionId), [sessionId, questionId]);
  const { state, reload } = useAsync(load, 'Разбор не открылся.');
  if (state.data) {
    return (
      <ReviewBody
        review={state.data}
        session={props.session}
        answer={question?.answer?.text ?? ''}
        company={props.company}
        responseId={props.responseId}
      />
    );
  }
  return (
    <div className="col">
      {state.status === 'error' ? (
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      ) : (
        <p className="ls-state" role="status">
          <span>Разбираем ответ…</span>
        </p>
      )}
    </div>
  );
}
