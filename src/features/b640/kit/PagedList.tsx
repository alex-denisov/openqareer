import { Fragment, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { StatusLine } from './ResultLine';

export interface PagedListProps<T> {
  readonly items: readonly T[];
  readonly renderItem: (item: T, index: number) => ReactNode;
  readonly pageSize?: number;
  /** Сколько всего записей; больше `items.length` — остальное подгружает `onLoadMore`. */
  readonly total?: number;
  readonly onLoadMore?: () => Promise<void> | void;
  readonly listClassName?: string;
}

const COUNT_FORMAT = new Intl.NumberFormat('ru-RU');

/** Список порциями: «20 из 1 500» и «Показать ещё 20» (`.vl-foot`). */
export function PagedList<T>({
  items,
  renderItem,
  pageSize = 20,
  total,
  onLoadMore,
  listClassName,
}: PagedListProps<T>) {
  const [shown, setShown] = useState(pageSize);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const all = Math.max(total ?? items.length, items.length);
  const visible = Math.min(shown, items.length);
  const left = (onLoadMore ? all : items.length) - visible;
  const step = Math.min(pageSize, left);

  async function showMore() {
    const next = shown + pageSize;
    if (next > items.length && items.length < all && onLoadMore) {
      setBusy(true);
      setFailed(false);
      try {
        await onLoadMore();
      } catch {
        setFailed(true);
        return;
      } finally {
        setBusy(false);
      }
    }
    setShown(next);
  }

  return (
    <>
      <ul className={listClassName}>
        {items.slice(0, visible).map((item, index) => (
          <Fragment key={index}>{renderItem(item, index)}</Fragment>
        ))}
      </ul>
      <div className="vl-foot ct-foot">
        <span className="ct-count num">{`${COUNT_FORMAT.format(visible)} из ${COUNT_FORMAT.format(all)}`}</span>
        {left > 0 ? (
          <Button icon="down" busy={busy} onClick={() => void showMore()}>
            <span>{`Показать ещё ${COUNT_FORMAT.format(step)}`}</span>
          </Button>
        ) : null}
      </div>
      {failed ? <StatusLine state="err" text="Не удалось загрузить. Нажмите ещё раз." /> : null}
    </>
  );
}
