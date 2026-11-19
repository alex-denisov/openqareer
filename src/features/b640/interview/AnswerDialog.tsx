import { useId, useState } from 'react';
import type { StarStoryView } from '../../../../shared/starStories';
import { Button, Dialog, StatusLine } from '../kit';
import type { PrepRow } from './model/prepModel';

export interface AnswerDialogProps {
  readonly question: PrepRow | null;
  readonly stories: readonly StarStoryView[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onPick: (story: StarStoryView) => void;
  readonly onClose: () => void;
}

function StoryList(props: {
  readonly stories: readonly StarStoryView[];
  readonly picked: string | null;
  readonly onPick: (id: string) => void;
}) {
  const name = useId();
  if (props.stories.length === 0) {
    return <p className="ls-state">Историй с примерами из опыта пока нет.</p>;
  }
  return (
    <ul className="rows">
      {props.stories.map((item) => (
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

/** «Подготовить ответ»: пример из ваших историй становится ответом на вопрос. */
export function AnswerDialog(props: AnswerDialogProps) {
  const usable = props.stories.filter((story) => story.sourceFactIds.length > 0);
  const [picked, setPicked] = useState<string | null>(usable[0]?.id ?? null);
  const story = usable.find((item) => item.id === picked) ?? null;
  const footer = (
    <>
      <Button
        variant="primary"
        disabled={!story || props.saving}
        onClick={() => (story ? props.onPick(story) : undefined)}
      >
        Взять пример
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
      <StoryList stories={usable} picked={picked} onPick={setPicked} />
      {props.error ? <StatusLine state="err" text={props.error} /> : null}
    </Dialog>
  );
}
