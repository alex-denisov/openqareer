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
  /** B734 «Дальше без изменений»: итог остаётся в проверке, в профиль не идёт. */
  readonly onKeepOut: () => void;
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

/** Дальше с записью в профиль, ещё раз или дальше без изменений (B734). */
function ResultActions(props: SkillResultProps & { readonly toProfile: boolean }) {
  return (
    <div className="actions">
      <Button variant="primary" icon="checkc" onClick={props.onNext}>
        {props.toProfile ? 'Подтвердить навык' : 'Дальше'}
      </Button>
      <Button icon="repeat" onClick={props.onAgain}>
        Пройти ещё раз
      </Button>
      {props.toProfile ? (
        <Button variant="quiet" busy={props.busy} onClick={props.onKeepOut}>
          Дальше без изменений
        </Button>
      ) : null}
    </div>
  );
}

/** C4b «Итог кейса»: пункты оценки, что попадёт в профиль, дальше или ещё раз. */
export function SkillResult(props: SkillResultProps) {
  const { record, busy, failed, onNext, onAppeal } = props;
  const [appealing, setAppealing] = useState(false);
  const { evaluation } = record;
  const line = record.keptOutOfProfile
    ? null
    : profileLine(record.assessmentCase.skillName, evaluation.grade);
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
        <div className="lt-ask" role="group" aria-labelledby="c4-ask">
          <p id="c4-ask">{line}</p>
          <div className="lt-ask-a">
            <Button icon="check" onClick={onNext}>
              Верно
            </Button>
            <button className="row-act" type="button" onClick={() => setAppealing(true)}>
              <Icon name="edit" />
              Исправить
            </button>
          </div>
        </div>
      ) : null}
      {appealing ? (
        <AppealField busy={busy} onSend={appeal} onCancel={() => setAppealing(false)} />
      ) : null}
      {failed ? <StatusLine state="err" text="Не отправилось. Попробуйте ещё раз." /> : null}
      <ResultActions {...props} toProfile={Boolean(line)} />
    </section>
  );
}
