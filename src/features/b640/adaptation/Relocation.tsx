import { useState } from 'react';
import { SegControl } from '../kit/SegControl';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import type { AdaptationPatch } from './adaptationApi';
import type { AdaptationData } from './useAdaptation';

type Answer = 'no' | 'yes' | '';
const OPTIONS = [
  { value: 'no' as const, label: 'Без переезда' },
  { value: 'yes' as const, label: 'Был переезд' },
];

/** Был ли переезд ради этой работы: ответ хранится в плане, релокация — в разделе «Карьера». */
export function Relocation({
  data,
  onPatch,
}: {
  readonly data: AdaptationData;
  readonly onPatch: (patch: AdaptationPatch) => Promise<void>;
}) {
  const relocated = data.view.relocated;
  const [failed, setFailed] = useState(false);
  const value: Answer = relocated === null ? '' : relocated ? 'yes' : 'no';
  async function answer(next: Answer) {
    setFailed(false);
    try {
      await onPatch({ relocated: next === 'yes' });
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="dn-fs">
      <SegControl label="Переезд ради этой работы" name="ap-move" value={value} options={OPTIONS} onChange={(next) => void answer(next)} />
      {failed ? <StatusLine state="err" text="Ответ не сохранился" /> : null}
      {relocated ? (
        <p className="lead-text">
          <Link className="row-act" to={buildNodePath('c06')}>
            Открыть релокацию
          </Link>
        </p>
      ) : null}
    </div>
  );
}
