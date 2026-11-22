import { useState } from 'react';
import type {
  DebriefLine,
  DebriefMetrics,
  DebriefQuestion,
} from '../../../../server/domain/interviewDebrief';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import { clock, durationText, shareParts, speakerLabel } from './model/debriefModel';

const lineId = (ms: number) => `t-${Math.floor(ms / 1000)}`;

/** Доля речи, темп и паузы; без разделения голосов — только темп и паузы. */
export function ShareLine({ metrics }: { readonly metrics: DebriefMetrics }) {
  const parts = shareParts(metrics);
  const pace = (
    <>
      темп <span className="num">{parts.tempo}</span> слов в минуту · пауз дольше 3 с:{' '}
      <span className="num">{parts.pauses}</span>
    </>
  );
  if (parts.candidate === null) {
    return (
      <div className="ir-share">
        <span>{pace}</span>
      </div>
    );
  }
  return (
    <div className="ir-share">
      <span>
        Ваша доля речи <b className="num">{parts.candidate}&nbsp;%</b> · интервьюер{' '}
        <span className="num">{parts.interviewer}&nbsp;%</span> · {pace}
      </span>
      <span className="meter" role="img" aria-label={`Ваша доля речи ${parts.candidate} процентов`}>
        <i style={{ inlineSize: `${parts.candidate}%` }} />
      </span>
    </div>
  );
}

function QuestionRow(props: {
  readonly item: DebriefQuestion;
  readonly responseId: string;
  readonly onOpenAt: () => void;
}) {
  const { item } = props;
  const at = clock(item.atMs);
  return (
    <li className="ir-q">
      <a
        className="ir-ts"
        href={`#${lineId(item.atMs)}`}
        aria-label={`Открыть расшифровку на ${at}`}
        onClick={props.onOpenAt}
      >
        {at}
      </a>
      <div className="ir-q-body">
        <div>
          <div className="row-title">{item.question}</div>
          {item.summary ? <div className="row-sub">{item.summary}</div> : null}
        </div>
        <span className={item.prepared ? 'tag ok' : 'tag part'}>
          {item.prepared ? 'было готово' : 'нужен ответ'}
        </span>
        {!item.prepared && item.fix ? (
          <div className="ir-fix">
            <span className="row-sub">Что поправить: {item.fix}</span>
            <Link className="row-act" to={buildNodePath('i01', { responseId: props.responseId })}>
              <Icon name="plus" />
              Подготовить ответ
            </Link>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Transcript(props: {
  readonly lines: readonly DebriefLine[];
  readonly durationMs: number;
  readonly interviewerName: string | null;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="ir-tr"
      id="tr"
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
    >
      <summary>
        <Icon name="down" />
        Расшифровка · {durationText(props.durationMs)}
      </summary>
      <ol className="rows">
        {props.lines.map((line) => {
          const who = speakerLabel(line.speaker, props.interviewerName);
          return (
            <li className="ir-seg" id={lineId(line.startMs)} key={`${line.startMs}-${line.text}`}>
              <span className="ir-ts">{clock(line.startMs)}</span>
              <span>
                {who ? <b>{who}:</b> : null} {line.text}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Вопросы с временем и расшифровка: время открывает расшифровку на этой строке. */
export function DebriefQuestions(props: {
  readonly responseId: string;
  readonly questions: readonly DebriefQuestion[];
  readonly lines: readonly DebriefLine[];
  readonly metrics: DebriefMetrics;
  readonly interviewerName: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {props.questions.length > 0 ? (
        <ul className="rows exp-rows">
          {props.questions.map((item) => (
            <QuestionRow
              key={`${item.atMs}-${item.question}`}
              item={item}
              responseId={props.responseId}
              onOpenAt={() => setOpen(true)}
            />
          ))}
        </ul>
      ) : null}
      {props.lines.length > 0 ? (
        <Transcript
          lines={props.lines}
          durationMs={props.metrics.durationMs}
          interviewerName={props.interviewerName}
          open={open}
          onToggle={setOpen}
        />
      ) : null}
    </>
  );
}
