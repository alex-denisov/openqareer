import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { listApplicationsPool, type ApplicationView } from '../../applications/applicationsApi';
import { Button, Icon, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { AutomationBar } from './AutomationBar';
import { useResponseMarks } from './data/responseSummaryApi';
import { useAsync, type AsyncState } from './data/useAsync';
import {
  DEFAULT_SORT,
  STAGE_CHIPS,
  chipCounts,
  filterRows,
  markAuto,
  sortRows,
  type ListedResponse,
  type SortKey,
  type SortState,
  type StageChip,
} from './model/responseList';
import { buildResponseRow, pluralRu } from './model/responseRow';
import { ResponseDetail } from './ResponseDetail';
import { ResponsesTable } from './ResponsesTable';
import { ownPanelPath } from '../vacancies/list/ownPanelLink';

const PAGE_SIZE = 20;

const SORT_MENU: readonly { readonly label: string; readonly sort: SortState }[] = [
  { label: 'По сроку действия', sort: DEFAULT_SORT },
  { label: 'По дате отклика', sort: { key: 'sent', direction: 'desc' } },
  { label: 'По компании', sort: { key: 'company', direction: 'asc' } },
];

async function loadResponses(signal: AbortSignal): Promise<readonly ApplicationView[]> {
  return (await listApplicationsPool({}, signal)).items;
}

function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: key === 'sent' ? 'desc' : 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

interface SortMenuProps {
  readonly sort: SortState;
  readonly onPick: (sort: SortState) => void;
}

/** Сортировка для 390: на компьютере сортируют заголовки столбцов. */
function SortMenu({ sort, onPick }: SortMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') setOpen(false);
  };
  return (
    <div className="ot-sortm">
      <button
        className="icon-btn ot-sortbtn"
        type="button"
        aria-label="Сортировка"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={closeOnEscape}
      >
        <Icon name="sortasc" />
      </button>
      <ul
        className="ot-sort-menu"
        id={id}
        role="menu"
        aria-label="Сортировка"
        hidden={!open}
        onKeyDown={closeOnEscape}
      >
        {SORT_MENU.map((item) => (
          <li role="none" key={item.label}>
            <button
              className="ot-sort-i"
              type="button"
              role="menuitemradio"
              aria-checked={item.sort.key === sort.key && item.sort.direction === sort.direction}
              onClick={() => {
                onPick(item.sort);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyResponses({ nodeCode }: { readonly nodeCode: string }) {
  return (
    <div className="page" data-b640-node={nodeCode} data-b640-section="responses">
      <section className="col vl-empty-wrap" aria-labelledby="oe-title">
        <div className="vl-empty" role="status">
          <h2 className="vl-empty-t" id="oe-title">
            Откликов пока нет
          </h2>
          <div className="actions">
            <Link className="btn is-primary" to={buildNodePath('s07')}>
              <Icon name="search" />
              Подобрать вакансии
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

interface ListState {
  readonly state: AsyncState<readonly ApplicationView[]>;
  readonly reload: () => void;
  readonly all: readonly ListedResponse[];
  readonly onChanged: (next: ApplicationView) => void;
}

function useResponsesList(): ListState {
  const load = useCallback((signal: AbortSignal) => loadResponses(signal), []);
  const { state, reload, setData } = useAsync(load, 'Отклики не загрузились.');
  const marks = useResponseMarks();
  const all = useMemo<readonly ListedResponse[]>(() => {
    const now = new Date();
    const rows = (state.data ?? []).map((application) => ({
      application,
      row: buildResponseRow(application, now, {
        letterApproved: marks.approvedLetters.has(application.id),
      }),
    }));
    return markAuto(rows, marks.auto);
  }, [state.data, marks]);
  const onChanged = useCallback(
    (next: ApplicationView) =>
      setData((items) => items.map((item) => (item.id === next.id ? next : item))),
    [setData],
  );
  return { state, reload, all, onChanged };
}

/** Esc сворачивает раскрытый отклик, если не открыто окно или меню. */
function useEscapeToList(active: boolean, navigate: (path: string) => void): void {
  useEffect(() => {
    if (!active) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.pf-dialog, [aria-haspopup][aria-expanded="true"], details[open]')) return;
      navigate(buildNodePath('o01'));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, navigate]);
}

function RetryLine({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text={text}
      action={
        <Button size="sm" onClick={onRetry}>
          Повторить
        </Button>
      }
    />
  );
}

interface HeadProps {
  readonly titleId: string;
  readonly total: number;
  readonly counts: Record<StageChip, number>;
  readonly chips: readonly StageChip[];
  readonly onChips: (chips: readonly StageChip[]) => void;
  readonly sort: SortState;
  readonly onSort: (sort: SortState) => void;
}

function ListHead({ titleId, total, counts, chips, onChips, sort, onSort }: HeadProps) {
  return (
    <div className="list-head ot-head">
      <h2 id={titleId}>{`${total} ${pluralRu(total, ['отклик', 'отклика', 'откликов'])}`}</h2>
      <div className="chips" role="group" aria-label="Стадии">
        {STAGE_CHIPS.map((chip) => {
          const pressed = chips.includes(chip.id);
          return (
            <button
              className="chip"
              type="button"
              key={chip.id}
              aria-pressed={pressed}
              onClick={() => onChips(pressed ? chips.filter((id) => id !== chip.id) : [...chips, chip.id])}
            >
              {chip.id === 'auto' ? chip.label : `${chip.label} · ${counts[chip.id]}`}
            </button>
          );
        })}
      </div>
      <SortMenu sort={sort} onPick={onSort} />
    </div>
  );
}

interface View {
  readonly visible: readonly ListedResponse[];
  readonly total: number;
  readonly left: number;
  readonly limit: number;
  readonly nextId: string | null;
}

/** Что показать: отфильтрованные строки порцией; раскрытый отклик виден всегда. */
function buildView(
  all: readonly ListedResponse[],
  opened: ListedResponse | null,
  chips: readonly StageChip[],
  sort: SortState,
  shown: number,
): View {
  const sorted = sortRows(filterRows(all, chips), sort);
  const openIndex = opened ? sorted.findIndex((item) => item.row.id === opened.row.id) : -1;
  const pinned = opened && openIndex < 0 ? [opened] : [];
  const limit = Math.max(shown, openIndex + 1);
  return {
    visible: [...pinned, ...sorted.slice(0, limit)],
    total: sorted.length,
    left: sorted.length - Math.min(limit, sorted.length),
    limit,
    nextId: opened
      ? null
      : (sorted.find((item) => item.row.action && item.row.yours)?.row.id ?? null),
  };
}

interface RowsProps {
  readonly view: View;
  readonly sort: SortState;
  readonly onSort: (sort: SortState) => void;
  readonly opened: ListedResponse | null;
  readonly onToggle: (id: string) => void;
  readonly onChanged: (next: ApplicationView) => void;
}

function ListRows({ view, sort, onSort, opened, onToggle, onChanged }: RowsProps) {
  if (view.visible.length === 0) {
    return (
      <p className="ls-state" role="status">
        В этих стадиях откликов нет
      </p>
    );
  }
  return (
    <ResponsesTable
      items={view.visible}
      sort={sort}
      onSort={(key) => onSort(nextSort(sort, key))}
      openId={opened ? opened.row.id : null}
      nextId={view.nextId}
      onToggle={onToggle}
      detail={
        opened ? (
          <ResponseDetail
            key={opened.row.id}
            item={opened}
            titleId={`otklik-${opened.row.id}-t`}
            onChanged={onChanged}
          />
        ) : null
      }
    />
  );
}

interface BodyProps extends ResponsesScreenProps {
  readonly list: ListState;
  readonly opened: ListedResponse | null;
}

function ListBody({ nodeCode, openId, list, opened }: BodyProps) {
  const { navigate } = useShell();
  const titleId = useId();
  const [chips, setChips] = useState<readonly StageChip[]>([]);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [shown, setShown] = useState(PAGE_SIZE);
  const view = buildView(list.all, opened, chips, sort, shown);
  const toggle = (id: string) =>
    navigate(id === openId ? buildNodePath('o01') : buildNodePath('o01c', { responseId: id }));
  return (
    <div className={opened ? 'page two ot-open' : 'page two'} data-b640-node={nodeCode} data-b640-section="responses">
      {opened ? (
        <header className="ot-mhead">
          <h2>{opened.row.role}</h2>
          <p>{opened.row.company}</p>
        </header>
      ) : null}
      <section className="col-wide ot-wrap" aria-labelledby={titleId}>
        <AutomationBar />
        <ListHead
          titleId={titleId}
          total={list.all.length}
          counts={chipCounts(list.all)}
          chips={chips}
          onChips={(next) => {
            setShown(PAGE_SIZE);
            setChips(next);
          }}
          sort={sort}
          onSort={setSort}
        />
        {list.state.status === 'error' ? (
          <RetryLine text={list.state.error} onRetry={list.reload} />
        ) : null}
        <ListRows
          view={view}
          sort={sort}
          onSort={setSort}
          opened={opened}
          onToggle={toggle}
          onChanged={list.onChanged}
        />
        <ListFoot view={view} missing={Boolean(openId) && !opened} onMore={() => setShown(view.limit + PAGE_SIZE)} />
      </section>
    </div>
  );
}

interface FootProps {
  readonly view: View;
  /** Адрес ведёт на отклик, которого нет. */
  readonly missing: boolean;
  readonly onMore: () => void;
}

function ListFoot({ view, missing, onMore }: FootProps) {
  return (
    <>
      {missing ? (
        <StatusLine
          state="err"
          text="Такого отклика нет"
          action={
            <Link className="btn is-sm" to={buildNodePath('o01')}>
              К откликам
            </Link>
          }
        />
      ) : null}
      {view.left > 0 ? (
        <div className="vl-foot">
          <span className="vl-shown num">{`${view.total - view.left} из ${view.total}`}</span>
          <Button icon="down" onClick={onMore}>
            {`Показать ещё ${Math.min(PAGE_SIZE, view.left)}`}
          </Button>
        </div>
      ) : null}
      <div className="vl-foot">
        <Link className="row-act" to={ownPanelPath()}>
          <Icon name="plus" />
          Откликнулся сам — добавить
        </Link>
      </div>
    </>
  );
}

export interface ResponsesScreenProps {
  /** Код узла: список (o01) или раскрытый отклик (o01c). */
  readonly nodeCode: 'o01' | 'o01c';
  readonly openId: string | null;
}

/** «Отклики»: список (O1) и тот же список с раскрытым откликом (O1c). */
export function ResponsesScreen({ nodeCode, openId }: ResponsesScreenProps) {
  const { navigate } = useShell();
  const list = useResponsesList();
  const opened = openId ? (list.all.find((item) => item.row.id === openId) ?? null) : null;
  useScreenChrome(
    nodeCode === 'o01c' ? { crumb: opened?.row.company, rootData: { mtight: '1' } } : {},
  );
  useEscapeToList(Boolean(openId), navigate);

  if (!list.state.data) {
    return (
      <div className="page two" data-b640-node={nodeCode} data-b640-section="responses">
        {list.state.status === 'error' ? (
          <RetryLine text={list.state.error} onRetry={list.reload} />
        ) : (
          <p className="ls-state" role="status">
            Загружаем отклики…
          </p>
        )}
      </div>
    );
  }
  if (list.all.length === 0) return <EmptyResponses nodeCode={nodeCode} />;
  return <ListBody nodeCode={nodeCode} openId={openId} list={list} opened={opened} />;
}
