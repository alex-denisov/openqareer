import { useEffect, useRef, type RefObject } from 'react';
import type { RoleTitlesRu } from '../../career/roleLabel';
import { Icon } from '../../kit';
import { vacanciesWord, type MoneyCurrency } from '../format';
import { FilterPane, type PaneProps } from './FilterPanes';
import { HiddenChip, type HiddenChipProps } from './HiddenChip';
import {
  CHIP_LIMIT,
  FILTER_KINDS,
  activeCount,
  chipsOf,
  hasChosen,
  labelOf,
  withoutChip,
  type FilterKind,
} from './filterModel';

export interface FiltersBarProps extends PaneProps, HiddenChipProps {
  readonly openKind: FilterKind | null;
  /** `null` — подборка ещё читается и число неполное (B728): кнопка без числа. */
  readonly shown: number | null;
  readonly onOpenKind: (kind: FilterKind | null) => void;
  readonly onOpenSheet: () => void;
  readonly onReset: () => void;
  /** B726: русские названия ролей поиска для чипов (`titlesRu` кампании). */
  readonly roleTitlesRu?: RoleTitlesRu;
}

export function RelocChip({ filters, onChange }: Pick<PaneProps, 'filters' | 'onChange'>) {
  return (
    <button className="chip vt-reloc" type="button" aria-pressed={filters.reloc} onClick={() => onChange({ ...filters, reloc: !filters.reloc })}>
      <Icon name="plane" />
      Релокация
    </button>
  );
}

function Popover(props: FiltersBarProps & { kind: FilterKind }) {
  const { kind, shown, onOpenKind } = props;
  const search = FILTER_KINDS.find((entry) => entry.kind === kind)?.search ?? '';
  return (
    <div className="vt-pop" id={`pop-${kind}`} role="dialog" aria-label={`Фильтры: ${search}`}>
      <div className="vt-pop-tabs" role="tablist" aria-label="Фильтры">
        {FILTER_KINDS.map((entry) => (
          <button key={entry.kind} className="vt-pop-tab" type="button" role="tab" aria-selected={entry.kind === kind} onClick={() => onOpenKind(entry.kind)}>
            {entry.name}
          </button>
        ))}
      </div>
      <FilterPane {...props} key={kind} kind={kind} />
      <HiddenChip showHidden={props.showHidden} onShowHidden={props.onShowHidden} />
      <div className="vt-pop-foot">
        <button className="btn is-quiet" type="button" onClick={props.onReset}>
          Сбросить
        </button>
        <button className="btn is-primary" type="button" onClick={() => onOpenKind(null)}>
          {shown === null ? 'Показать' : `Показать ${shown} ${vacanciesWord(shown)}`}
        </button>
      </div>
    </div>
  );
}

function Chips({ filters, roleTitlesRu, currency, onChange, onReset, onMore }: Pick<FiltersBarProps, 'filters' | 'roleTitlesRu' | 'currency' | 'onChange' | 'onReset'> & { onMore: () => void }) {
  const chips = chipsOf(filters, currency, roleTitlesRu);
  const shown = chips.slice(0, CHIP_LIMIT);
  const rest = chips.length - shown.length;
  return (
    <ul className="vt-chips" aria-label="Выбранные фильтры">
      <li className="only-mob">
        <RelocChip filters={filters} onChange={onChange} />
      </li>
      {shown.map((chip) => (
        <li key={`${chip.kind}:${chip.id}`}>
          <span className="vt-chip">
            {chip.label}
            <button type="button" aria-label={`Убрать: ${chip.label}`} onClick={() => onChange(withoutChip(filters, chip))}>
              <Icon name="close" />
            </button>
          </span>
        </li>
      ))}
      {rest > 0 ? (
        <li>
          <button className="vt-more" type="button" onClick={onMore}>
            + ещё {rest}
          </button>
        </li>
      ) : null}
      {hasChosen(filters) ? (
        <li>
          <button className="vt-reset" type="button" onClick={onReset}>
            Сбросить всё
          </button>
        </li>
      ) : null}
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
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

/** Панель фильтров: кнопки с поповером (1440/1176), «Фильтры · N» и чипы (390). */
export function FiltersBar(props: FiltersBarProps) {
  const { filters, currency, openKind, onOpenKind } = props;
  const root = useRef<HTMLDivElement>(null);
  useCloseOnOutside(openKind !== null, root, () => onOpenKind(null));
  const more = () => {
    const first = chipsOf(filters, currency)[CHIP_LIMIT];
    props.onOpenSheet();
    if (first && !window.matchMedia('(max-width: 767px)').matches) onOpenKind(first.kind);
  };
  return (
    <div ref={root} className="vt-filters" role="group" aria-label="Фильтры вакансий">
      <div className="vt-fbar">
        {FILTER_KINDS.map((entry) => {
          const open = openKind === entry.kind;
          return (
            <div className="vt-fwrap" key={entry.kind}>
              <button className="vt-fbtn" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={`pop-${entry.kind}`} onClick={() => onOpenKind(open ? null : entry.kind)}>
                {labelOf(entry.kind, filters, currency as MoneyCurrency)}
                <Icon name="down" className="vt-chev" />
              </button>
              {open ? <Popover {...props} kind={entry.kind} /> : null}
            </div>
          );
        })}
        <div className="vt-fwrap">
          <RelocChip filters={filters} onChange={props.onChange} />
        </div>
      </div>
      <button className="vt-mfilter" type="button" aria-haspopup="dialog" aria-controls="vt-sheet" onClick={props.onOpenSheet}>
        <Icon name="funnel" />
        Фильтры · {activeCount(filters)}
      </button>
      <Chips filters={filters} roleTitlesRu={props.roleTitlesRu} currency={currency} onChange={props.onChange} onReset={props.onReset} onMore={more} />
    </div>
  );
}
