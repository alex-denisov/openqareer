import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { B640ContactSort } from '../../../../../shared/b640Contacts';
import { Icon } from '../../kit';
import { useModalFocus } from '../../kit/useModalFocus';
import { ContactPane, type PaneProps } from './ContactPanes';
import { contactsWord } from './contactsModel';
import { KINDS, SORT_OPTIONS, kindLabel } from './contactsFilters';

export interface ContactSheetProps extends PaneProps {
  readonly open: boolean;
  readonly total: number;
  readonly sort: B640ContactSort;
  readonly onSort: (sort: B640ContactSort) => void;
  readonly onClose: () => void;
  readonly onReset: () => void;
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="vt-sec" open={open}>
      <summary>
        <span>{title}</span>
        <Icon name="down" className="vt-chev" />
      </summary>
      <div className="vt-sec-body">{children}</div>
    </details>
  );
}

function SortPane({ sort, onSort }: Pick<ContactSheetProps, 'sort' | 'onSort'>) {
  const name = useId();
  return (
    <ul className="vt-opts">
      {SORT_OPTIONS.map((option) => (
        <li key={option.id}>
          <label className="vt-opt">
            <input type="radio" name={name} checked={sort === option.id} onChange={() => onSort(option.id)} />
            <span className="vt-opt-t">{option.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function SheetBody(props: ContactSheetProps) {
  const sortLabel = SORT_OPTIONS.find((option) => option.id === props.sort)?.label ?? '';
  return (
    <div className="vt-sheet-body">
      <Section title={`Сортировка · ${sortLabel}`}>
        <SortPane sort={props.sort} onSort={props.onSort} />
      </Section>
      {KINDS.map((kind) => (
        <Section key={kind} title={kindLabel(kind, props.filters)} open={kind === 'company'}>
          <ContactPane kind={kind} {...props} />
        </Section>
      ))}
    </div>
  );
}

/** Нижний лист фильтров на 390: модальный, фокус внутри, Esc закрывает. */
export function ContactSheet(props: ContactSheetProps) {
  const { open, onClose } = props;
  const titleId = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(anchor.current?.closest<HTMLElement>('.b640') ?? null);
  }, []);
  const shown = open && host !== null;
  useModalFocus(shown, { host, dialog, back }, onClose);
  return (
    <>
      <span ref={anchor} hidden />
      {shown
        ? createPortal(
            <>
              <div ref={back} className="backdrop only-mob" aria-hidden="true" onClick={onClose} />
              <div ref={dialog} className="vt-sheet" id="ct-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
                <span className="grab" aria-hidden="true" />
                <div className="vt-sheet-head">
                  <h2 id={titleId}>Фильтры</h2>
                  <button className="btn is-primary vt-sheet-go" type="button" onClick={onClose}>
                    Показать {props.total} {contactsWord(props.total)}
                  </button>
                  <button className="icon-btn" type="button" aria-label="Закрыть фильтры" onClick={onClose}>
                    <Icon name="close" />
                  </button>
                </div>
                <SheetBody {...props} />
                <div className="vt-sheet-foot">
                  <button className="btn is-quiet" type="button" onClick={props.onReset}>
                    Сбросить всё
                  </button>
                </div>
              </div>
            </>,
            host,
          )
        : null}
    </>
  );
}
