import { Fragment, type ReactNode } from 'react';
import { PagedList } from '../../kit';

const PAGE = 20;

/** Список порциями только когда записей больше страницы; короткий список — без счётчика. */
export function LinkedinList<T>({
  items,
  listClassName,
  renderItem,
}: {
  readonly items: readonly T[];
  readonly listClassName: string;
  readonly renderItem: (item: T, index: number) => ReactNode;
}) {
  if (items.length > PAGE) {
    return (
      <PagedList
        items={items}
        pageSize={PAGE}
        listClassName={listClassName}
        renderItem={renderItem}
      />
    );
  }
  return (
    <ul className={listClassName}>
      {items.map((item, index) => (
        <Fragment key={index}>{renderItem(item, index)}</Fragment>
      ))}
    </ul>
  );
}
