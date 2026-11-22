import { useState } from 'react';
import type { DebriefAgreement } from '../../../../server/domain/interviewDebrief';
import { Button, Icon, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { acceptAgreement } from './data/debriefApi';
import { clock } from './model/debriefModel';

type FactState = 'idle' | 'editing' | 'saving' | 'saved' | 'failed';

function FactText(props: {
  readonly editing: boolean;
  readonly text: string;
  readonly atMs: number;
  readonly onChange: (text: string) => void;
}) {
  return props.editing ? (
    <div className="field">
      <label htmlFor={`fact-${props.atMs}`}>Договорённость</label>
      <textarea
        id={`fact-${props.atMs}`}
        value={props.text}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  ) : (
    <div className="row-title">
      {props.text} ·{' '}
      <a className="ir-ts" href={`#t-${Math.floor(props.atMs / 1000)}`}>
        {clock(props.atMs)}
      </a>
    </div>
  );
}

function Fact(props: { readonly responseId: string; readonly item: DebriefAgreement }) {
  const [text, setText] = useState(props.item.text);
  const [state, setState] = useState<FactState>('idle');
  async function accept() {
    setState('saving');
    try {
      await acceptAgreement(props.responseId, text.trim());
      setState('saved');
    } catch {
      setState('failed');
    }
  }
  return (
    <li className="ir-fact">
      <FactText
        editing={state === 'editing'}
        text={text}
        atMs={props.item.atMs}
        onChange={setText}
      />
      {state === 'saved' ? (
        <StatusLine state="ok" text="Записано в отклик" />
      ) : (
        <div className="actions">
          <Button disabled={state === 'saving' || !text.trim()} onClick={() => void accept()}>
            <Icon name="check" />
            Верно — в отклик
          </Button>
          {state === 'editing' ? null : (
            <button className="row-act" type="button" onClick={() => setState('editing')}>
              <Icon name="edit" />
              Поправить
            </button>
          )}
        </div>
      )}
      {state === 'failed' ? (
        <StatusLine state="err" text="Не записалось. Попробуйте ещё раз." />
      ) : null}
    </li>
  );
}

export function Agreements(props: {
  readonly responseId: string;
  readonly items: readonly DebriefAgreement[];
}) {
  if (props.items.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="db-facts">
      <div className="eyebrow">Из записи</div>
      <h3 className="mod-title" id="db-facts">
        Что договорились
      </h3>
      <ul className="rows">
        {props.items.map((item) => (
          <Fact key={`${item.atMs}-${item.text}`} responseId={props.responseId} item={item} />
        ))}
      </ul>
    </section>
  );
}

/** «К следующей встрече»: то, что поправить в ответах, ведёт в подготовку. */
export function NextPrep(props: {
  readonly responseId: string;
  readonly items: readonly string[];
}) {
  if (props.items.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="db-next">
      <div className="eyebrow">К следующей встрече</div>
      {props.items.map((item, index) => (
        <h3 className="mod-title" id={index === 0 ? 'db-next' : undefined} key={item}>
          {item}
        </h3>
      ))}
      <div className="actions">
        <Link className="btn" to={buildNodePath('i01', { responseId: props.responseId })}>
          <Icon name="plus" />
          Подготовить ответ
        </Link>
      </div>
    </section>
  );
}

/** Модель не ответила: метрики и заметки на месте, разбор можно повторить. */
export function AnalysisRetry(props: { readonly busy: boolean; readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text="Разбор вопросов не получился."
      action={
        <Button size="sm" disabled={props.busy} onClick={props.onRetry}>
          <Icon name="refresh" />
          Повторить разбор
        </Button>
      }
    />
  );
}
