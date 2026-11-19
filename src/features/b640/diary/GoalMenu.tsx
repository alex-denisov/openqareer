import { useId, useState } from 'react';
import { DIARY_NOTE_MAX, type CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { useToast } from '../kit/Toast';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { archiveGoal, restoreGoal } from './diaryApi';

interface ArchiveDialogProps {
  readonly card: CareerDiaryGoalCard;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
}

/** «В архив»: причина одной строкой — она видна в ⓘ у цели в архиве. */
function ArchiveDialog({ card, open, onClose, onDone }: ArchiveDialogProps) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      await archiveGoal(card.id, reason.trim());
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const footer = (
    <>
      <Button onClick={onClose}>Отмена</Button>
      <Button variant="primary" busy={busy} disabled={!reason.trim()} onClick={() => void save()}>
        В архив
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Убрать цель в архив?" footer={footer}>
      <div className="field">
        <label htmlFor={`${id}-r`}>Почему</label>
        <input
          id={`${id}-r`}
          type="text"
          maxLength={DIARY_NOTE_MAX}
          placeholder="Например: отменена директором, банк меняет платформу"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {failed ? <StatusLine state="err" text="Не получилось. Повторите." /> : null}
    </Dialog>
  );
}

interface MenuListProps {
  readonly card: CareerDiaryGoalCard;
  readonly open: boolean;
  readonly onRestore: () => void;
  readonly onArchive: () => void;
}

function MenuList({ card, open, onRestore, onArchive }: MenuListProps) {
  return (
    <ul className="lk-menu-l" role="menu" hidden={!open}>
      <li role="none">
        <Link role="menuitem" to={`${buildNodePath('d02b')}?goal=${encodeURIComponent(card.id)}`}>
          Изменить цель
        </Link>
      </li>
      <li role="none">
        {card.details.archive ? (
          <button role="menuitem" type="button" onClick={onRestore}>
            Вернуть из архива
          </button>
        ) : (
          <button role="menuitem" type="button" onClick={onArchive}>
            В архив
          </button>
        )}
      </li>
    </ul>
  );
}

/** Меню «Ещё действия: цель» (`div.lk-menu`): изменить, в архив или вернуть. */
export function GoalMenu({
  card,
  onChanged,
}: {
  readonly card: CareerDiaryGoalCard;
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const toast = useToast();
  const restore = () => {
    setOpen(false);
    restoreGoal(card.id).then(onChanged, () => toast.show({ text: 'Цель не вернулась' }));
  };
  return (
    <div className="lk-menu">
      <button
        className="icon-btn"
        type="button"
        aria-label="Ещё действия: цель"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <MenuList
        card={card}
        open={open}
        onRestore={restore}
        onArchive={() => (setOpen(false), setArchiving(true))}
      />
      <ArchiveDialog
        card={card}
        open={archiving}
        onClose={() => setArchiving(false)}
        onDone={() => {
          setArchiving(false);
          toast.show({ text: 'Цель в архиве' });
          onChanged();
        }}
      />
    </div>
  );
}
