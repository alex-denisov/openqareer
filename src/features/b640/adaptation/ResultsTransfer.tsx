import { useEffect, useState } from 'react';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import type { CareerDiaryResultItem } from '../../../../shared/careerDiaryCheckpoints';
import { listGoalCards } from '../diary/diaryApi';
import { GoalTransferDialog } from '../diary/GoalTransfer';
import { ActionDock, Button, InfoTip } from '../kit';

const CHECK_TIP =
  'Перед добавлением записи проверяются на внутренние данные работодателя; в профиль идёт только то, что вы записали.';

/** Достигнутые цели итогов: их карточки (строка результата и «перенесено» живут в карточке). */
export function useAchievedCards(items: readonly CareerDiaryResultItem[]) {
  const [cards, setCards] = useState<readonly CareerDiaryGoalCard[]>([]);
  useEffect(() => {
    let active = true;
    const done = new Set(items.filter((item) => item.status === 'done').map((item) => item.goalId));
    if (done.size === 0) return undefined;
    listGoalCards().then(
      (loaded) =>
        active &&
        setCards(
          loaded.items.filter((card) => done.has(card.id) && card.risk.status === 'achieved'),
        ),
      () => active && setCards([]),
    );
    return () => {
      active = false;
    };
  }, [items]);
  const replace = (card: CareerDiaryGoalCard) =>
    setCards((current) => current.map((item) => (item.id === card.id ? card : item)));
  return { cards, replace };
}

export interface TransferBarProps {
  readonly cards: readonly CareerDiaryGoalCard[];
  readonly onDone: (card: CareerDiaryGoalCard) => void;
}

/**
 * «Добавить в профиль»: кнопка и общая галочка над строками итогов. Нет достигнутых целей —
 * нет и кнопки. Все перенесены — кнопка остаётся, но не нажимается, а галочки нет.
 */
export function TransferBar({ cards, onDone }: TransferBarProps) {
  const [all, setAll] = useState(true);
  const [open, setOpen] = useState(false);
  if (cards.length === 0) return null;
  const pending = cards.filter((card) => !card.details.transfer);
  return (
    <>
      <ActionDock
        kind="commit"
        primary={
          <Button
            variant="primary"
            icon="profile"
            disabled={pending.length === 0}
            onClick={() => setOpen(true)}
          >
            Добавить в профиль
          </Button>
        }
      />
      {pending.length > 0 ? (
        <div className="check dn-all">
          <input
            type="checkbox"
            id="rs-all"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
          />
          <label htmlFor="rs-all">Добавить в профиль все подтверждённые</label>
          <InfoTip label="Проверка записей" text={CHECK_TIP} />
        </div>
      ) : null}
      {open && pending.length > 0 ? (
        <GoalTransferDialog
          cards={pending}
          preselected={all}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}
