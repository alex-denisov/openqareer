import { useId, useState } from 'react';
import type { LinkedinQueueItem, LinkedinRhythm } from '../../../../../shared/b640LinkedinQueue';
import { Button, DateInput, Dialog, Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { countWord } from './linkedinModel';
import { removeQueueItem, rescheduleQueueItem } from './linkedinQueueApi';
import { nextText, queueWhen } from './rhythmModel';
import { RhythmPopover } from './RhythmPopover';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;

interface RowProps {
  readonly item: LinkedinQueueItem;
  readonly timezone: string;
  readonly onChanged: () => void;
}

/** «Перенести»: день и время; новое время — в будущем. */
function MoveDialog({
  item,
  open,
  onClose,
  onChanged,
}: RowProps & { readonly open: boolean; readonly onClose: () => void }) {
  const id = useId();
  const [day, setDay] = useState(item.scheduledAt.slice(0, 10));
  const [time, setTime] = useState('10:00');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = () => {
    const at = day && CLOCK.test(time) ? new Date(`${day}T${time}`) : null;
    if (!at || at.getTime() <= Date.now()) return setError('Укажите день и время в будущем');
    setBusy(true);
    rescheduleQueueItem(item.id, at.toISOString())
      .then(() => (onClose(), onChanged()))
      .catch(() => setError('Не перенеслось. Попробуйте ещё раз'))
      .finally(() => setBusy(false));
  };
  const footer = (
    <>
      <Button onClick={onClose}>Отмена</Button>
      <Button variant="primary" busy={busy} onClick={save}>
        Перенести
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Перенести комментарий" footer={footer}>
      <div className="field">
        <label htmlFor={`${id}-d`}>День</label>
        <DateInput id={`${id}-d`} value={day} onChange={setDay} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-t`}>Время</label>
        <input
          id={`${id}-t`}
          type="text"
          inputMode="numeric"
          value={time}
          onChange={(event) => setTime(event.target.value.trim())}
        />
      </div>
      {error ? <StatusLine state="err" text={error} /> : null}
    </Dialog>
  );
}

function RowMenu({ item, timezone, onChanged }: RowProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const remove = () => {
    setOpen(false);
    removeQueueItem(item.id).then(onChanged, () => setFailed(true));
  };
  return (
    <div className="lk-menu">
      <button
        className="icon-btn"
        type="button"
        aria-label={`Ещё действия: комментарий ${item.text.slice(0, 40)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <ul className="lk-menu-l" role="menu" hidden={!open}>
        <li role="none">
          <button role="menuitem" type="button" onClick={remove}>
            Снять с очереди
          </button>
        </li>
        <li role="none">
          <button role="menuitem" type="button" onClick={() => (setOpen(false), setMoving(true))}>
            Перенести
          </button>
        </li>
      </ul>
      {failed ? <StatusLine state="err" text="Не снялось с очереди. Попробуйте ещё раз" /> : null}
      <MoveDialog
        item={item}
        timezone={timezone}
        open={moving}
        onClose={() => setMoving(false)}
        onChanged={onChanged}
      />
    </div>
  );
}

export interface CommentQueueProps {
  readonly rhythm: LinkedinRhythm;
  /** Комментарии очереди (`queued` и `due`), по времени. */
  readonly items: readonly LinkedinQueueItem[];
  readonly onChanged: () => void;
  readonly onRhythm: (rhythm: LinkedinRhythm) => void;
}

/** a05b: комментарии в очереди с точным временем; «Настроить ритм» (a05e) — у ближайшего. */
export function CommentQueue({ rhythm, items, onChanged, onRhythm }: CommentQueueProps) {
  const now = Date.now();
  const tz = rhythm.timezone;
  const count = `${items.length} ${countWord(items.length, 'комментарий', 'комментария', 'комментариев')} в очереди`;
  const [first] = items;
  return (
    <>
      <div className="list-head">
        <h2 id="cq-title">{count}</h2>
      </div>
      <div className="lk-next">
        {first ? (
          <p className="lk-next-t">
            Следующий — <span className="num">{nextText(first.scheduledAt, tz, now)}</span>
          </p>
        ) : null}
        <RhythmPopover rhythm={rhythm} onSaved={onRhythm} />
      </div>
      <ul className="rows exp-rows" aria-labelledby="cq-title">
        {items.map((item) => (
          <li key={item.id} className="row lk-q">
            <div className="lk-q-l">
              <span className="num">{queueWhen(item.scheduledAt, tz, now)}</span> ·{' '}
              <span className="lk-q-t">{item.text}</span>
            </div>
            <RowMenu item={item} timezone={tz} onChanged={onChanged} />
          </li>
        ))}
      </ul>
      <div className="actions">
        <Link className="btn" to={buildNodePath('a05c')}>
          <Icon name="list" />
          Открыть журнал
        </Link>
      </div>
    </>
  );
}
