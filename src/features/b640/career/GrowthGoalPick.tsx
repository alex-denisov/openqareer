import { useState } from 'react';
import { StatusLine } from '../kit';
import { saveGrowthGoal, type GrowthGoalKind } from './growthApi';
import { GOAL_OPTIONS } from './growthModel';

/** Выбор цели роста (s12a): одно нажатие сохраняет цель с датой выбора. */
export function GrowthGoalPick(props: {
  readonly current: GrowthGoalKind | null;
  readonly onSaved: () => void;
}) {
  const [busy, setBusy] = useState<GrowthGoalKind | null>(null);
  const [failed, setFailed] = useState(false);
  const choose = async (kind: GrowthGoalKind) => {
    if (busy) return;
    setBusy(kind);
    setFailed(false);
    try {
      await saveGrowthGoal(kind);
      props.onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="chips goal-chips" role="group" aria-label="Цель на следующий шаг">
        {GOAL_OPTIONS.map(([kind, label]) => (
          <button
            className="chip"
            type="button"
            key={kind}
            aria-pressed={props.current === kind}
            aria-busy={busy === kind}
            onClick={() => void choose(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {failed ? <StatusLine state="err" text="Цель не сохранилась. Попробуйте ещё раз." /> : null}
    </>
  );
}
