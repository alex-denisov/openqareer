import { useEffect, useRef, type RefObject } from 'react';
import { Icon } from '../../kit';
import { ContactPane, type PaneProps } from './ContactPanes';
import { contactsWord } from './contactsModel';
import { KINDS, KIND_LABELS, activeCount, chipsOf, kindLabel, withoutChip, type ContactKind } from './contactsFilters';

export interface ContactFiltersProps extends PaneProps {
  readonly total: number;
  readonly openKind: ContactKind | null;
  readonly onOpenKind: (kind: ContactKind | null) => void;
  readonly onOpenSheet: () => void;
  readonly onReset: () => void;
}

function Popover({ kind, ...props }: ContactFiltersProps & { kind: ContactKind }) {
  return (
    <div className="vt-pop" id={`pop-${kind}`} role="dialog" aria-label={`Фильтр: ${KIND_LABELS[kind]}`}>
      <ContactPane {...props} kind={kind} />
      <div className="vt-pop-foot">
        <button className="btn is-quiet" type="button" onClick={props.onReset}>
          Сбросить
        </button>
        <button className="btn is-primary" type="button" onClick={() => props.onOpenKind(null)}>
          Показать {props.total} {contactsWord(props.total)}
        </button>
      </div>
    </div>
  );
}

/** Выбранное фильтрами — снимаемые чипы и «Сбросить всё». */
export function ContactChips({ filters, onChange, onReset }: Pick<ContactFiltersProps, 'filters' | 'onChange' | 'onReset'>) {
  const chips = chipsOf(filters);
  if (chips.length === 0) return null;
  return (
    <ul className="vt-chips ct-chips" aria-label="Выбранные фильтры">
      {chips.map((chip) => (
        <li key={`${chip.kind}:${chip.id}`}>
          <span className="vt-chip">
            {chip.label}
            <button type="button" aria-label={`Убрать: ${chip.label}`} onClick={() => onChange(withoutChip(filters, chip))}>
              <Icon name="close" />
            </button>
          </span>
        </li>
      ))}
      <li>
        <button className="vt-reset" type="button" onClick={onReset}>
          Сбросить всё
        </button>
      </li>
    </ul>
  );
}

/** Поповер закрывается по Esc и по нажатию мимо панели фильтров. */
function useCloseOnOutside(active: boolean, root: RefObject<HTMLElement>, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeRef.current();
    const onPointer = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [active, root]);
}

/** «Компания / Связь / Статус» с поповерами (1440, 1176) и кнопка «Фильтры» (390). */
export function ContactFilterBar(props: ContactFiltersProps) {
  const { filters, openKind, onOpenKind } = props;
  const root = useRef<HTMLDivElement>(null);
  useCloseOnOutside(openKind !== null, root, () => onOpenKind(null));
  const count = activeCount(filters);
  return (
    <div ref={root} className="vt-filters ct-filters" role="group" aria-label="Фильтры контактов">
      <div className="vt-fbar">
        {KINDS.map((kind) => {
          const open = openKind === kind;
          return (
            <div className="vt-fwrap" key={kind}>
              <button className="vt-fbtn" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={`pop-${kind}`} onClick={() => onOpenKind(open ? null : kind)}>
                {kindLabel(kind, filters)}
                <Icon name="down" className="vt-chev" />
              </button>
              {open ? <Popover {...props} kind={kind} /> : null}
            </div>
          );
        })}
      </div>
      <button className="vt-mfilter" type="button" aria-haspopup="dialog" aria-controls="ct-sheet" onClick={props.onOpenSheet}>
        <Icon name="funnel" />
        {count > 0 ? `Фильтры · ${count}` : 'Фильтры'}
      </button>
    </div>
  );
}
