import { useCallback, useState } from 'react';
import type { StarStoryView } from '../../../../shared/starStories';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { AnswerDialog } from './AnswerDialog';
import { loadPrep, putStarPrep, type PrepData, type SalaryFloor } from './data/prepApi';
import {
  buildPrepRows,
  paragraphsFromStory,
  prepHeadline,
  replaceQuestionParagraphs,
  type PrepRow,
} from './model/prepModel';
import { InterviewHead, PrepSteps } from './PrepSteps';
import { WhenForm } from './WhenForm';

const CURRENCY: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€' };

function floorText(floor: SalaryFloor): string {
  const amount = new Intl.NumberFormat('ru-RU').format(floor.amount).replace(/\s/g, ' ');
  return `от ${amount} ${CURRENCY[floor.currency] ?? floor.currency}`;
}

function Row({ row }: { readonly row: PrepRow }) {
  return (
    <li className="row">
      <div>
        <div className="row-title">{row.title}</div>
        <div className="row-sub">{row.sub}</div>
      </div>
      <span className={row.ready ? 'tag ok' : 'tag part'}>
        {row.ready ? 'готово' : 'нужен ответ'}
      </span>
    </li>
  );
}

function SalaryRow({ floor }: { readonly floor: SalaryFloor }) {
  return (
    <li className="row">
      <div>
        <div className="row-title">Ожидания по зарплате</div>
        <div className="row-sub">
          Ответ готов · {floorText(floor)}
          <InfoTip
            label="Откуда ответ"
            text="Ожидания — из вашего профиля. Текущий доход в ответ не входит."
          />
        </div>
      </div>
      <span className="tag ok">готово</span>
    </li>
  );
}

/** Ответ из истории: абзацы этого вопроса заменяются, остальные остаются. */
function useAnswer(data: PrepData, onSaved: (next: PrepData) => void) {
  const [question, setQuestion] = useState<PrepRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pick(story: StarStoryView) {
    const own = question ? paragraphsFromStory(question.id, story) : null;
    if (!question || !own) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await putStarPrep(
        data.response.id,
        replaceQuestionParagraphs(data.paragraphs, question.id, own),
      );
      onSaved({ ...data, paragraphs: saved });
      setQuestion(null);
    } catch {
      setError('Ответ не сохранился. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }
  const open = (row: PrepRow | null) => {
    setError(null);
    setQuestion(row);
  };
  return { question, saving, error, pick, open };
}

function PrepActions(props: {
  readonly responseId: string;
  readonly next: PrepRow | null;
  readonly onPrepare: (row: PrepRow) => void;
}) {
  const { next } = props;
  return (
    <div className="actions">
      {next ? (
        <Button variant="primary" onClick={() => props.onPrepare(next)}>
          <Icon name="plus" />
          Подготовить ответ
        </Button>
      ) : null}
      <Link className="btn" to={buildNodePath('i02', { responseId: props.responseId })}>
        <Icon name="play" />
        Пробное интервью
      </Link>
    </div>
  );
}

function PrepLead({
  data,
  onSaved,
}: {
  readonly data: PrepData;
  readonly onSaved: (next: PrepData) => void;
}) {
  const rows = buildPrepRows(data.questions, data.paragraphs, data.stories);
  const total = rows.length + (data.floor ? 1 : 0);
  const ready = rows.filter((row) => row.ready).length + (data.floor ? 1 : 0);
  const next = rows.find((row) => !row.ready) ?? null;
  const answer = useAnswer(data, onSaved);
  return (
    <section className="lead" aria-labelledby="iv-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="iv-title">
          {prepHeadline(ready, total)}
        </h2>
        <InfoTip
          label="Откуда вопросы"
          text="Вопросы — по должности из вакансии, на которую вы откликнулись. Готовый ответ — пример из ваших историй об опыте."
        />
      </div>
      <PrepActions responseId={data.response.id} next={next} onPrepare={answer.open} />
      <ul className="rows exp-rows">
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
        {data.floor ? <SalaryRow floor={data.floor} /> : null}
      </ul>
      {answer.question ? (
        <AnswerDialog
          question={answer.question}
          stories={data.stories}
          saving={answer.saving}
          error={answer.error}
          onPick={(story) => void answer.pick(story)}
          onClose={() => answer.open(null)}
        />
      ) : null}
    </section>
  );
}

function AskThem({ questions }: { readonly questions: readonly string[] }) {
  if (questions.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="ask-title">
      <h3 className="mod-title" id="ask-title">
        Спросите сами
      </h3>
      <ul className="change">
        {questions.map((question) => (
          <li key={question}>
            <Icon name="question" />
            {question}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrepBody(props: { readonly data: PrepData; readonly onSaved: (next: PrepData) => void }) {
  return (
    <>
      <div className="col">
        <PrepLead data={props.data} onSaved={props.onSaved} />
      </div>
      <div className="col">
        <AskThem questions={props.data.askThem} />
      </div>
    </>
  );
}

function Waiting({
  error,
  onRetry,
}: {
  readonly error: string | null;
  readonly onRetry: () => void;
}) {
  if (error) {
    return (
      <StatusLine
        state="err"
        text={error}
        action={
          <Button size="sm" onClick={onRetry}>
            Повторить
          </Button>
        }
      />
    );
  }
  return (
    <p className="ls-state" role="status">
      <span>Готовим вопросы…</span>
    </p>
  );
}

function NoInterview() {
  return (
    <StatusLine
      state="wait"
      text="Интервью пока не назначено ни по одному отклику."
      action={
        <Link className="row-act" to={buildNodePath('o01')}>
          К откликам
        </Link>
      }
    />
  );
}

/** «Подготовка к интервью» (I1) и «Когда интервью?» (I1d). */
export function PrepScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadPrep(responseId, signal), [responseId]);
  const { state, reload, replaceData } = useAsync(load, 'Подготовка не загрузилась.');
  const data = state.data;
  const id = data?.response.id ?? responseId;
  const scheduled = Boolean(data?.response.nearestInterview);
  // На I1 мобильные отступы плотные (`data-mtight`), на I1d — обычные, как в макетах.
  useScreenChrome({ rootData: data && !scheduled ? {} : { mtight: '1' } });
  return (
    <>
      <PrepSteps responseId={id} current="prep" />
      <div
        className={data && !scheduled ? 'page' : 'page two'}
        data-b640-node={data && !scheduled ? 'i01d' : 'i01'}
        data-b640-section="interview"
      >
        {data ? <InterviewHead response={data.response} /> : null}
        {state.status === 'ready' && data === null ? <NoInterview /> : null}
        {data && scheduled ? <PrepBody data={data} onSaved={replaceData} /> : null}
        {data && !scheduled ? <WhenForm responseId={data.response.id} onCreated={reload} /> : null}
        {!data && state.status !== 'ready' ? (
          <Waiting error={state.status === 'error' ? state.error : null} onRetry={reload} />
        ) : null}
      </div>
    </>
  );
}
