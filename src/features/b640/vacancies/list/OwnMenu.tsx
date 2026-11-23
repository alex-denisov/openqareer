import { useRef } from 'react';
import { MenuButton, useMenuDismiss } from './RowMenu';

export interface OwnMenuProps {
  readonly id: string;
  readonly title: string;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

/** «…» своей вакансии на 390: там кнопка корзины скрыта, «Удалить» живёт в окне действий. */
export function OwnMenu({ id, title, onRemove, onClose }: OwnMenuProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useMenuDismiss(dialog, 'list', onClose);
  const remove = () => {
    onClose();
    onRemove();
  };
  return (
    <>
      <div className="va-m-back" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialog}
        className="va-pop va-m is-list"
        id={`va-m-${id}`}
        role="dialog"
        tabIndex={-1}
        aria-label={`Действия: ${title}`}
      >
        <span className="grab" aria-hidden="true" />
        <ul className="va-m-list">
          <MenuButton icon="trash" label="Удалить" onClick={remove} />
        </ul>
      </div>
    </>
  );
}
