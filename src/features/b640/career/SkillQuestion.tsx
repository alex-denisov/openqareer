import { ActionDock, Button, Icon, StatusLine } from '../kit';
import { SkillAnswerField } from './SkillAnswerField';

export const EVAL_ERROR = 'Оценка не получилась';

export interface SkillQuestionProps {
  readonly eyebrow: string;
  readonly title: string;
  /** По чему оценивается ответ кейса; у вопросов о роли пунктов нет. */
  readonly criteria?: readonly string[];
  readonly answer: string;
  readonly busy: boolean;
  /** Сбой оценки или сохранения: строка на месте, ответ остаётся в поле. */
  readonly failed: boolean;
  readonly onChange: (answer: string) => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly onLater: () => void;
}

/** «Оценим по трём пунктам»: по чему оценивается ответ кейса (макет C4). */
function Criteria({ items }: { readonly items?: readonly string[] }) {
  if (!items?.length) return null;
  return (
    <div className="change">
      <h3>Оценим по {items.length === 3 ? 'трём пунктам' : 'пунктам'}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Icon name="right" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Вопрос проверки (C4): разговор о роли и кейсы выглядят одинаково. */
export function SkillQuestion(props: SkillQuestionProps) {
  const { eyebrow, title, answer, busy, failed } = props;
  const retry = (
    <span className="st-act">
      <Button size="sm" icon="repeat" busy={busy} onClick={props.onRetry}>
        Повторить
      </Button>
    </span>
  );
  return (
    <section className="lead" aria-labelledby="q-title">
      <div className="eyebrow">
        <Icon name="checkc" />
        {eyebrow}
      </div>
      <h2 className="mod-title" id="q-title">
        {title}
      </h2>
      <Criteria items={props.criteria} />
      <SkillAnswerField value={answer} onChange={props.onChange} disabled={busy} />
      <ActionDock
        kind="commit"
        primary={
          <Button
            variant="primary"
            icon="send"
            busy={busy}
            disabled={!answer.trim()}
            onClick={props.onSubmit}
          >
            Ответить
          </Button>
        }
        secondary={
          <button className="row-act" type="button" onClick={props.onLater}>
            Пропустить · продолжу позже
          </button>
        }
      />
      {failed ? <StatusLine state="err" text={EVAL_ERROR} action={retry} /> : null}
    </section>
  );
}
