import { useId, useState } from 'react';
import type { StarStoryView } from '../../../../shared/starStories';
import { Button, Dialog, Icon, StatusLine } from '../kit';
import type { PrepRow } from './model/prepModel';

/** Предел текста одного ответа на сервере (`starPrepValidation`). */
const ANSWER_MAX = 2000;
const OWN = 'own';

export interface AnswerDialogProps {
  readonly question: PrepRow | null;
  readonly stories: readonly StarStoryView[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onPick: (story: StarStoryView) => void;
  readonly onWrite: (text: string) => void;
  readonly onClose: () => void;
}

function StoryList(props: {
  readonly stories: readonly StarStoryView[];
  readonly picked: string;
  readonly onPick: (id: string) => void;
}) {
  const name = useId();
  const options = [
    ...props.stories.map(({ id, title }) => ({ id, title })),
    { id: OWN, title: 'Написать свой ответ' },
  ];
  return (
    <ul className="rows">
      {options.map((item) => (
        <li className="row" key={item.id}>
          <label className="vt-opt">
            <input
              type="radio"
              name={name}
              checked={props.picked === item.id}
              onChange={() => props.onPick(item.id)}
            />
            <span className="vt-opt-t">{item.title}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function OwnAnswer(props: {
  readonly text: string;
  readonly empty: boolean;
  readonly onText: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className="pf-f">
      <label htmlFor={id}>Ваш ответ</label>
      <textarea
        id={id}
        value={props.text}
        maxLength={ANSWER_MAX}
        aria-invalid={props.empty ? true : undefined}
        aria-describedby={props.empty ? `${id}-err` : undefined}
        onChange={(event) => props.onText(event.currentTarget.value)}
      />
      {props.empty ? (
        <small className="is-err" id={`${id}-err`}>
          <Icon name="warn" />
          Напишите ответ
        </small>
      ) : null}
    </div>
  );
}

/** «Подготовить ответ»: пример из ваших историй или ответ своими словами. */
export function AnswerDialog(props: AnswerDialogProps) {
  const usable = props.stories.filter((story) => story.sourceFactIds.length > 0);
  const [picked, setPicked] = useState(usable[0]?.id ?? OWN);
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const story = usable.find((item) => item.id === picked) ?? null;
  const empty = !text.trim();
  function save() {
    if (story) return props.onPick(story);
    setTried(true);
    if (!empty) props.onWrite(text);
  }
  const footer = (
    <>
      <Button variant="primary" disabled={props.saving} onClick={save}>
        {story ? 'Взять пример' : 'Сохранить ответ'}
      </Button>
      <Button variant="quiet" onClick={props.onClose}>
        Отмена
      </Button>
    </>
  );
  return (
    <Dialog
      open={props.question !== null}
      onClose={props.onClose}
      title={props.question?.title ?? ''}
      footer={footer}
    >
      {usable.length > 0 ? <StoryList stories={usable} picked={picked} onPick={setPicked} /> : null}
      {story ? null : <OwnAnswer text={text} empty={tried && empty} onText={setText} />}
      {props.error ? <StatusLine state="err" text={props.error} /> : null}
    </Dialog>
  );
}
