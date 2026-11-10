import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import {
  ArrowsClockwise,
  CalendarBlank,
  Funnel,
  Plugs,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import {
  FILTER_OPTION_TITLE_ID,
  FilterOptionSheet,
  FilterRow,
  type FilterOption,
} from './ResponsesStageSheet';
import {
  DEFAULT_FILTER_DRAFT,
  draftResultCount,
  type ResponsesFilterDraft,
  type ResponsesPeriod,
} from './responsesFilterDraft';
import type { ResponsesSortMode } from './responsesFiltering';
import { humanSourceLabel } from './sourceLabels';

export interface FilterStageItem {
  readonly key: string;
  readonly count: string;
  readonly apply: () => void;
}

export interface ResponsesFilterSheetProps {
  readonly applications: readonly ApplicationView[];
  readonly channels: readonly string[];
  readonly query: ApplicationListQuery;
  readonly search: string;
  readonly sortMode: ResponsesSortMode;
  readonly period: ResponsesPeriod;
  /** The rows of the applied period are all loaded, so counting them is honest. */
  readonly loadedAll: boolean;
  /** Empty when this screen has no «Этап» choice. */
  readonly stageItems: readonly FilterStageItem[];
  readonly currentStage: string;
  readonly onQueryChange: (query: ApplicationListQuery) => void;
  readonly onSortChange: (mode: ResponsesSortMode) => void;
  readonly onPeriodChange: (period: ResponsesPeriod) => void;
}

type FilterChoice = 'stage' | 'channel' | 'period' | 'sort';

const PERIOD_OPTIONS: readonly FilterOption[] = [
  { key: '7', label: '7 дней' },
  { key: '30', label: '30 дней' },
  { key: '90', label: '90 дней' },
  { key: 'all', label: 'Всё время' },
];

const SORT_OPTIONS: readonly FilterOption[] = [
  { key: 'step', label: 'По сроку шага' },
  { key: 'newest', label: 'Сначала новые' },
  { key: 'oldest', label: 'Сначала старые' },
];

const CHOICE_TITLE: Readonly<Record<FilterChoice, string>> = {
  stage: 'Этап',
  channel: 'Канал',
  period: 'Период',
  sort: 'Сортировка',
};

function stageLabel(key: string): string {
  return key.charAt(0).toLocaleUpperCase('ru-RU') + key.slice(1);
}

function channelOptions(channels: readonly string[]): readonly FilterOption[] {
  return [
    { key: '', label: 'Все' },
    ...channels.map((channel) => ({ key: channel, label: humanSourceLabel(channel) })),
  ];
}

function optionLabel(options: readonly FilterOption[], key: string): string {
  return options.find((option) => option.key === key)?.label ?? key;
}

function trapDialogTab(
  event: ReactKeyboardEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement | null,
) {
  if (event.key !== 'Tab' || !dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  );
  if (focusable.length === 0) return;
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (activeIndex < 0 || (event.shiftKey && activeIndex === 0)) {
    event.preventDefault();
    focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
  } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault();
    focusable[0]?.focus();
  }
}

/** «Показать N»: null until the pool is loaded, so the button never shows a wrong one. */
function useDraftCount(
  props: ResponsesFilterSheetProps,
  draft: ResponsesFilterDraft,
): number | null {
  // The whole pool is loaded (B632): every period is counted from the rows at hand.
  return props.loadedAll ? draftResultCount(props.applications, draft, props.search) : null;
}

function draftFromProps(props: ResponsesFilterSheetProps): ResponsesFilterDraft {
  return {
    stage: props.currentStage,
    channel: props.query.channel?.[0] ?? '',
    period: props.period,
    sortMode: props.sortMode,
  };
}

function applyDraft(props: ResponsesFilterSheetProps, draft: ResponsesFilterDraft) {
  const stageItem = props.stageItems.find((item) => item.key === draft.stage);
  if (stageItem && draft.stage !== props.currentStage) stageItem.apply();
  props.onQueryChange({ channel: draft.channel ? [draft.channel] : [], offset: 0 });
  props.onPeriodChange(draft.period);
  props.onSortChange(draft.sortMode);
}

/** A click outside the sheet lands on the dialog element itself, above its box. */
function useBackdropClose(dialogRef: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog && event.clientY < dialog.getBoundingClientRect().top) {
        dialog.close();
      }
    };
    dialog.addEventListener('click', onClick);
    return () => dialog.removeEventListener('click', onClick);
  }, [dialogRef]);
}

function useFilterSheet(props: ResponsesFilterSheetProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromProps(props));
  const [choice, setChoice] = useState<FilterChoice | null>(null);
  useBackdropClose(dialogRef);
  const open = () => {
    setDraft(draftFromProps(props));
    setChoice(null);
    dialogRef.current?.showModal();
    // The sheet itself takes focus: a highlighted «Сбросить» on open is not in the mockup.
    dialogRef.current?.focus();
    setIsOpen(true);
  };
  const backToFilters = () => {
    const row = choice;
    setChoice(null);
    window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>(`[data-filter-row="${row}"]`)?.focus(),
    );
  };
  const handleClose = () => {
    setIsOpen(false);
    setChoice(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  /** Escape steps back from a choice to the filters, and closes from the filters. */
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (!choice) return;
    event.preventDefault();
    backToFilters();
  };
  return {
    triggerRef,
    dialogRef,
    isOpen,
    draft,
    setDraft,
    choice,
    setChoice,
    open,
    backToFilters,
    handleClose,
    handleCancel,
  };
}

type FilterSheetState = ReturnType<typeof useFilterSheet>;

export function ResponsesFilterSheet(props: ResponsesFilterSheetProps) {
  const state = useFilterSheet(props);
  return (
    <>
      <button
        ref={state.triggerRef}
        type="button"
        className="career-responses-filters-trigger"
        aria-haspopup="dialog"
        aria-expanded={state.isOpen}
        aria-controls="career-responses-filter-dialog"
        onClick={state.open}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span>Фильтры</span>
      </button>
      <dialog
        ref={state.dialogRef}
        id="career-responses-filter-dialog"
        className="career-responses-filter-dialog"
        tabIndex={-1}
        aria-labelledby={state.choice ? FILTER_OPTION_TITLE_ID : 'career-responses-filter-title'}
        aria-modal="true"
        onClose={state.handleClose}
        onCancel={state.handleCancel}
        onKeyDown={(event) => trapDialogTab(event, state.dialogRef.current)}
      >
        {state.choice ? (
          <FilterChoiceSheet props={props} state={state} choice={state.choice} />
        ) : (
          <FilterForm props={props} state={state} />
        )}
      </dialog>
    </>
  );
}

function FilterForm({
  props,
  state,
}: {
  readonly props: ResponsesFilterSheetProps;
  readonly state: FilterSheetState;
}) {
  const { draft } = state;
  const count = useDraftCount(props, draft);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        applyDraft(props, draft);
        state.dialogRef.current?.close();
      }}
    >
      <span className="career-responses-filter-grab" aria-hidden="true" />
      <header className="career-responses-filter-head">
        <h2 id="career-responses-filter-title">Фильтры</h2>
        <button
          type="button"
          className="career-responses-filter-text"
          onClick={() => state.setDraft(DEFAULT_FILTER_DRAFT)}
        >
          Сбросить
        </button>
      </header>
      <FilterRows props={props} state={state} />
      <button type="submit" className="career-responses-filter-show">
        {count === null ? 'Показать' : `Показать ${count.toLocaleString('ru-RU')}`}
      </button>
    </form>
  );
}

function FilterRows({
  props,
  state,
}: {
  readonly props: ResponsesFilterSheetProps;
  readonly state: FilterSheetState;
}) {
  const { draft, setChoice } = state;
  return (
    <div className="career-responses-filter-list">
      {props.stageItems.length > 0 ? (
        <FilterRow
          rowKey="stage"
          icon={<Funnel />}
          label="Этап"
          value={stageLabel(draft.stage)}
          onOpen={() => setChoice('stage')}
        />
      ) : null}
      <FilterRow
        rowKey="channel"
        icon={<Plugs />}
        label="Канал"
        value={optionLabel(channelOptions(props.channels), draft.channel)}
        onOpen={() => setChoice('channel')}
      />
      <FilterRow
        rowKey="period"
        icon={<CalendarBlank />}
        label="Период"
        value={optionLabel(PERIOD_OPTIONS, draft.period)}
        onOpen={() => setChoice('period')}
      />
      <FilterRow
        rowKey="sort"
        icon={<ArrowsClockwise />}
        label="Сортировка"
        value={optionLabel(SORT_OPTIONS, draft.sortMode)}
        onOpen={() => setChoice('sort')}
      />
    </div>
  );
}

function FilterChoiceSheet({
  props,
  state,
  choice,
}: {
  readonly props: ResponsesFilterSheetProps;
  readonly state: FilterSheetState;
  readonly choice: FilterChoice;
}) {
  const { options, value, pick } = choiceBinding(props, state, choice);
  return (
    <FilterOptionSheet
      title={CHOICE_TITLE[choice]}
      options={options}
      value={value}
      onPick={(key) => {
        pick(key);
        state.backToFilters();
      }}
      onClose={state.backToFilters}
    />
  );
}

function choiceBinding(
  props: ResponsesFilterSheetProps,
  state: FilterSheetState,
  choice: FilterChoice,
): {
  readonly options: readonly FilterOption[];
  readonly value: string;
  readonly pick: (key: string) => void;
} {
  const { draft, setDraft } = state;
  if (choice === 'stage') {
    return {
      options: props.stageItems.map((item) => ({
        key: item.key,
        label: stageLabel(item.key),
        count: item.count,
      })),
      value: draft.stage,
      pick: (stage) => setDraft((current) => ({ ...current, stage })),
    };
  }
  if (choice === 'channel') {
    return {
      options: channelOptions(props.channels),
      value: draft.channel,
      pick: (channel) => setDraft((current) => ({ ...current, channel })),
    };
  }
  if (choice === 'period') {
    return {
      options: PERIOD_OPTIONS,
      value: draft.period,
      pick: (period) => setDraft((current) => ({ ...current, period: period as ResponsesPeriod })),
    };
  }
  return {
    options: SORT_OPTIONS,
    value: draft.sortMode,
    pick: (sortMode) =>
      setDraft((current) => ({ ...current, sortMode: sortMode as ResponsesSortMode })),
  };
}
