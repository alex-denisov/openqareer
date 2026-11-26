import { useId, useState } from 'react';
import type {
  RoleSkillAssessmentRun,
  RoleSkillEvaluation,
} from '../../../../server/domain/roleSkillAssessment';
import { Button, Icon, StatusLine } from '../kit';
import { gradeTag, profileLine, resultTitle } from './skillCheckModel';

type RunCase = RoleSkillAssessmentRun['cases'][number];

export interface SkillResultProps {
  readonly record: RunCase & { readonly evaluation: RoleSkillEvaluation };
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onNext: () => void;
  /** «Пропустить»: навык остаётся как был. */
  readonly onSkip: () => void;
  readonly onAgain: () => void;
  readonly onAppeal: (reason: string) => Promise<boolean>;
}

function Criteria({ evaluation }: { readonly evaluation: RoleSkillEvaluation }) {
  return (
    <ul className="rows exp-rows" aria-label="Результат по критериям">
      {evaluation.criteria.map((item) => {
        const tag = gradeTag(item.grade);
        return (
          <li className="row" key={item.criterionId}>
            <div>
              <div className="row-title">{item.explanation}</div>
              <div className="row-sub">{item.candidateExcerpt}</div>
            </div>
            <span className={`tag ${tag.tone}`}>{tag.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AppealField(props: {
  readonly busy: boolean;
  readonly onSend: (reason: string) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  return (
    <div className="field" role="group" aria-label="Исправить оценку">
      <label htmlFor={id}>Что оценка упустила</label>
      <textarea id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
      <div className="actions">
        <Button
          icon="send"
          busy={props.busy}
          disabled={!reason.trim()}
          onClick={() => void props.onSend(reason)}
        >
          Отправить на пересмотр
        </Button>
        <Button variant="quiet" onClick={props.onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** «В профиль попадёт… Верно?»: до ответа навык не меняется (B734). */
function ProfileAsk(props: {
  readonly line: string;
  readonly busy: boolean;
  readonly onYes: () => void;
  readonly onAppeal: () => void;
  readonly onSkip?: () => void;
}) {
  return (
    <div className="lt-ask" role="group" aria-labelledby="c4-ask">
      <p id="c4-ask">{props.line}</p>
      <div className="lt-ask-a">
        <Button icon="check" busy={props.busy} onClick={props.onYes}>
          Верно
        </Button>
        <button className="row-act" type="button" onClick={props.onAppeal}>
          <Icon name="edit" />
          Исправить
        </button>
        {props.onSkip ? (
          <button className="row-act" type="button" disabled={props.busy} onClick={props.onSkip}>
            Пропустить
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** C4b «Итог кейса»: пункты оценки, что попадёт в профиль, дальше или ещё раз. */
export function SkillResult(props: SkillResultProps) {
  const { record, busy, failed, onNext, onSkip, onAgain, onAppeal } = props;
  const [appealing, setAppealing] = useState(false);
  const { evaluation } = record;
  const { decision } = record;
  // Принятый итог уже в профиле: спрашивать второй раз нечего.
  const line =
    decision === 'accepted' ? null : profileLine(record.assessmentCase.skillName, evaluation.grade);
  const skippable = decision === 'pending' || decision === 'declined';
  const appeal = async (reason: string) => {
    const sent = await onAppeal(reason);
    if (sent) setAppealing(false);
    return sent;
  };
  return (
    <section className="lead" aria-labelledby="q-title">
      <h2 className="lead-title is-long" id="q-title">
        {resultTitle(evaluation)}
      </h2>
      <Criteria evaluation={evaluation} />
      {line && !appealing ? (
        <ProfileAsk
          line={line}
          busy={busy}
          onYes={onNext}
          onAppeal={() => setAppealing(true)}
          onSkip={skippable ? onSkip : undefined}
        />
      ) : null}
      {appealing ? (
        <AppealField busy={busy} onSend={appeal} onCancel={() => setAppealing(false)} />
      ) : null}
      {failed ? <StatusLine state="err" text="Не отправилось. Попробуйте ещё раз." /> : null}
      <div className="actions">
        <Button variant="primary" icon="checkc" busy={busy} onClick={onNext}>
          {line ? 'Подтвердить навык' : 'Дальше'}
        </Button>
        <Button icon="repeat" onClick={onAgain}>
          Пройти ещё раз
        </Button>
      </div>
    </section>
  );
}
