import type { ReactNode } from 'react';
import type { InterviewAnswerMode } from '../../interview/interviewSimulatorApi';
import type { TariffQuotaStatus } from '../../tariffs/tariffQuotaApi';
import { Button, Icon, InfoTip } from '../kit';
import type { PracticeTask as Task } from './data/practiceApi';
import { shownPoints } from './model/practiceModel';

const SOURCE_TIP: Readonly<Record<Task['basis'], string>> = {
  vacancy: 'Из описания вакансии, сохранённого при отклике.',
  role: 'По должности: в сохранённом описании вакансии нет деталей о системе.',
};

const sourceTip = (task: Task): string =>
  (task.caseKind ?? 'system') === 'system' || task.basis === 'vacancy'
    ? SOURCE_TIP[task.basis]
    : 'По должности из отклика.';

function HowToAnswer(props: {
  readonly mode: InterviewAnswerMode;
  readonly voice: boolean;
  readonly onMode: (mode: InterviewAnswerMode) => void;
}) {
  if (!props.voice) return null;
  const options = [
    ['voice', 'mic', 'Голосом'],
    ['text', 'edit', 'Текстом'],
  ] as const;
  return (
    <fieldset className="decide pre-act">
      <legend>Как отвечать</legend>
      <div className="seg-ctl sd-two" role="radiogroup" aria-label="Как отвечать">
        {options.map(([value, icon, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="sd-how"
              checked={props.mode === value}
              onChange={() => props.onMode(value)}
            />
            <span>
              <Icon name={icon} />
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Requirements({ task }: { readonly task: Task }) {
  return (
    <section className="sd-task" aria-labelledby="sa-task">
      <h3 className="mod-title" id="sa-task">
        Что важно в задаче
        <InfoTip label="Источник" text={sourceTip(task)} />
      </h3>
      <ul className="sd-reqs">
        {shownPoints(task).map((point) => (
          <li key={point}>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="sd-time">
        <Icon name="timer" />
        <span>
          <span className="num">{task.timeLimitMinutes}</span> минут на ответ
        </span>
      </p>
    </section>
  );
}

function quotaLine(quota: TariffQuotaStatus | null): string | null {
  return quota ? `Пробные интервью: осталось ${quota.remaining} из ${quota.limit}` : null;
}

/** I3a: что важно в задаче, время и способ ответа; «Начать» заводит тренировку. */
export function PracticeTask(props: {
  readonly task: Task;
  readonly subtitle: string;
  readonly mode: InterviewAnswerMode;
  readonly voice: boolean;
  readonly quota: TariffQuotaStatus | null;
  readonly busy: boolean;
  /** Тренировка уже идёт: способ ответа выбран. */
  readonly running: boolean;
  /** Вместо «Начать»: возврат к ответу или переход на тариф. */
  readonly action: ReactNode | null;
  readonly onMode: (mode: InterviewAnswerMode) => void;
  readonly onStart: () => void;
}) {
  const { task } = props;
  const quota = quotaLine(props.quota);
  return (
    <section className="lead" aria-labelledby="sa-title">
      <h2 className="lead-title is-long" id="sa-title">
        {task.title}
      </h2>
      <p className="lead-sub">{props.subtitle}</p>
      <Requirements task={task} />
      {props.running ? null : (
        <HowToAnswer mode={props.mode} voice={props.voice} onMode={props.onMode} />
      )}
      {props.action ?? (
        <>
          <div className="actions">
            <Button variant="primary" busy={props.busy} onClick={props.onStart}>
              <Icon name="play" />
              Начать
            </Button>
            {quota ? <small className="act-q num">{quota}</small> : null}
          </div>
        </>
      )}
    </section>
  );
}
