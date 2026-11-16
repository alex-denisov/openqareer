import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../kit';
import { useModalFocus } from '../../kit/useModalFocus';
import { FilterPane, type PaneProps } from './FilterPanes';
import { dateLabel, labelOf, type FilterKind } from './filterModel';
import { SORT_COLUMNS, type SortKey, type SortState } from './sortModel';

export interface FilterSheetProps extends PaneProps {
  readonly open: boolean;
  readonly shown: number;
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
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

function SortPane({ sort, onSort }: Pick<FilterSheetProps, 'sort' | 'onSort'>) {
  const name = useId();
  return (
    <ul className="vt-opts">
      {SORT_COLUMNS.map((column) => (
        <li key={column.key}>
          <label className="vt-opt">
            <input type="radio" name={name} checked={sort.key === column.key} onChange={() => onSort(column.key)} />
            <span className="vt-opt-t">
              {column.label}
              {sort.key === column.key ? (sort.dir === 'desc' ? ' · по убыванию' : ' · по возрастанию') : ''}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const SECTIONS: ReadonlyArray<{ readonly kind: FilterKind; readonly open: boolean }> = [
  { kind: 'money', open: true },
  { kind: 'roles', open: true },
  { kind: 'locations', open: false },
  { kind: 'formats', open: false },
  { kind: 'dates', open: false },
];

function sectionTitle(kind: FilterKind, props: PaneProps): string {
  const { filters, currency } = props;
  if (kind === 'roles') return `Роли · ${filters.roles.length}`;
  if (kind === 'locations') return `Локации · ${filters.locations.length}`;
  if (kind === 'formats') return `Формат · ${filters.formats.length + Number(filters.reloc)}`;
  if (kind === 'dates') return `Дата · ${dateLabel(filters.date)}`;
  return filters.moneyFrom === null ? 'Деньги' : labelOf('money', filters, currency);
}

function SheetBody(props: FilterSheetProps) {
  const sortLabel = SORT_COLUMNS.find((column) => column.key === props.sort.key)?.label ?? '';
  return (
    <div className="vt-sheet-body">
      <Section title={`Сортировка · ${sortLabel}`}>
        <SortPane sort={props.sort} onSort={props.onSort} />
      </Section>
      {SECTIONS.map((section) => (
        <Section key={section.kind} title={sectionTitle(section.kind, props)} open={section.open}>
          <FilterPane kind={section.kind} {...props} />
        </Section>
      ))}
    </div>
  );
}

/** Нижний лист фильтров на 390: модальный, фокус внутри, Esc закрывает. */
export function FilterSheet(props: FilterSheetProps) {
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
              <div ref={dialog} className="vt-sheet" id="vt-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
                <span className="grab" aria-hidden="true" />
                <div className="vt-sheet-head">
                  <h2 id={titleId}>Фильтры</h2>
                  <button className="btn is-primary vt-sheet-go" type="button" onClick={onClose}>
                    Показать {props.shown}
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
