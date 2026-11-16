import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitPercent, vacancyFitTier } from '../../../../../shared/vacancyFitPercent';
import { Icon } from '../../kit';
import { BarPart } from '../Bar';
import type { FitBlockState } from './fitRows';
import { FitWhy } from './FitWhy';

export interface FitBlockProps {
  readonly state: FitBlockState;
  readonly view: VacancyFitView | undefined;
  readonly sourceName: string;
  readonly onRetry: () => void;
}

function Counting() {
  return (
    <div className="v4-fit is-busy" role="status" aria-busy="true">
      <span className="v4-fit-n">Считаем совпадение…</span>
      <span className="v4-fit-bar is-skel" aria-hidden="true" />
      <span className="v4-fit-slot" aria-hidden="true" />
    </div>
  );
}

function Failed({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="v4-fit is-err" role="alert">
      <span className="v4-fit-n">
        <Icon name="warn" />
        Не удалось посчитать совпадение
      </span>
      <button className="btn is-sm v4-retry" type="button" aria-label="Повторить" onClick={onRetry}>
        <Icon name="refresh" />
        <span className="v4-lbl">Повторить</span>
      </button>
    </div>
  );
}

function NoProfile() {
  return (
    <div className="v4-none" role="note">
      <p className="v4-none-t">Нет профиля</p>
      <p className="v4-none-x">Загрузите резюме — посчитаем совпадение.</p>
    </div>
  );
}

function NoPercent({ hidden }: { readonly hidden: boolean }) {
  return (
    <div className="v4-none" role="note">
      <p className="v4-none-t">{hidden ? 'Текст вакансии скрыт' : 'Мало требований для расчёта'}</p>
    </div>
  );
}

function Counted({ view, sourceName }: { readonly view: VacancyFitView; readonly sourceName: string }) {
  const percent = vacancyFitPercent(view) ?? 0;
  return (
    <div className="v4-fit">
      <span className="v4-fit-n num">Совпадение {percent} %</span>
      <span className="v4-fit-bar" role="img" aria-label={`Совпадение ${percent} %`}>
        <BarPart className={`is-${vacancyFitTier(percent)}`} size={percent} />
      </span>
      <FitWhy percent={percent} view={view} sourceName={sourceName} />
    </div>
  );
}

/** Совпадение с профилем во всех состояниях: считаем, не вышло, нет профиля, мало требований, число. */
export function FitBlock({ state, view, sourceName, onRetry }: FitBlockProps) {
  if (state === 'busy') return <Counting />;
  if (state === 'err') return <Failed onRetry={onRetry} />;
  if (state === 'none') return <NoProfile />;
  if (state === 'few' || !view) return <NoPercent hidden={Boolean(view?.textHidden)} />;
  return <Counted view={view} sourceName={sourceName} />;
}
