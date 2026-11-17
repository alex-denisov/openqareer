import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { SkipReasonId } from '../../../../../shared/skipReasons';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { Icon, Link, type IconName } from '../../kit';
import { buildNodePath } from '../../routes';
import { safeHttpUrl } from '../format';
import { HIDE_REASONS } from '../skipApi';
import { parseShortDate } from '../vacancyLinks';

export type MenuView = 'list' | 'hide' | 'applied';

export interface RowMenuActions {
  readonly want: () => Promise<void>;
  readonly hide: (reason: SkipReasonId) => Promise<void>;
  readonly applied: (occurredAt: string) => Promise<void>;
}

export interface RowMenuProps {
  readonly item: MatchedVacancyItem;
  readonly initialView: MenuView;
  readonly actions: RowMenuActions;
  readonly onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

/** Сегодняшняя дата для поля «дд.мм» по Москве. */
export function todayField(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(now);
}

/** Закрытие по Esc и по нажатию мимо; фокус уходит в окно и возвращается на открывшую кнопку. */
export function useMenuDismiss(
  dialog: RefObject<HTMLDivElement>,
  view: MenuView,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dialog.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.va')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      opener?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [dialog, view]);
}

function Head({ id, title, onBack }: { id: string; title: string; onBack: () => void }) {
  return (
    <div className="va-m-h">
      <button className="icon-btn" type="button" aria-label="Назад к действиям" onClick={onBack}>
        <Icon name="left" />
      </button>
      <h4 className="va-m-t" id={id}>
        {title}
      </h4>
    </div>
  );
}

export function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p className="va-err va-m-err" role="alert">
      <Icon name="warn" />
      {text}
      <button className="row-act" type="button" onClick={onRetry}>
        Повторить
      </button>
    </p>
  );
}

export interface Runner {
  readonly pending: boolean;
  readonly error: string | null;
  readonly run: (task: () => Promise<void>) => void;
  readonly retry: () => void;
}

/** Одно действие за раз: ожидание и ошибка остаются в окне, «Повторить» гонит то же действие. */
export function useRunner(): Runner {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<(() => Promise<void>) | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = (task: () => Promise<void>) => {
    last.current = task;
    setPending(true);
    setError(null);
    task()
      .catch((reason: unknown) => {
        if (!mounted.current) return;
        setError(reason instanceof Error && reason.message ? reason.message : 'Не получилось');
      })
      .finally(() => {
        if (mounted.current) setPending(false);
      });
  };
  return { pending, error, run, retry: () => last.current && run(last.current) };
}

export function MenuButton({ icon, label, onClick, cls = 'va-mi', disabled, go }: { icon: IconName; label: string; onClick: () => void; cls?: string; disabled?: boolean; go?: boolean }) {
  return (
    <li>
      <button className={cls} type="button" disabled={disabled} onClick={onClick}>
        <Icon name={icon} />
        <span>{label}</span>
        {go ? <Icon name="right" className="va-mi-go" /> : null}
      </button>
    </li>
  );
}

function ListView({ item, runner, actions, onView }: { item: MatchedVacancyItem; runner: Runner; actions: RowMenuActions; onView: (view: MenuView) => void }) {
  const [copied, setCopied] = useState(false);
  const { cluster } = item;
  const href = safeHttpUrl(cluster.primaryUrl);
  const copy = () =>
    runner.run(async () => {
      if (!href) throw new Error('У вакансии нет ссылки');
      await navigator.clipboard.writeText(href);
      setCopied(true);
    });
  return (
    <>
      <ul className="va-m-list">
        <MenuButton icon="building" label="Хочу в компанию" disabled={runner.pending} onClick={() => runner.run(actions.want)} />
        <MenuButton icon="check" label="Уже откликнулись" go onClick={() => onView('applied')} />
        <MenuButton icon="close" label="Не подходит" go cls="va-mi only-mob" onClick={() => onView('hide')} />
        {href ? (
          <li>
            <a className="va-mi" href={href} target="_blank" rel="noopener noreferrer">
              <Icon name="out" />
              Открыть на сайте работодателя
            </a>
          </li>
        ) : null}
        {href ? (
          <MenuButton icon={copied ? 'check' : 'copy'} label={copied ? 'Ссылка скопирована' : 'Скопировать ссылку'} onClick={copy} />
        ) : null}
        <li>
          <Link className="va-mi" to={buildNodePath('o02', { responseId: cluster.id })}>
            <Icon name="mail" />
            Подготовить письмо
          </Link>
        </li>
      </ul>
      {runner.error ? <ErrorLine text={runner.error} onRetry={runner.retry} /> : null}
    </>
  );
}

function HideView({ uid, runner, actions, onBack }: { uid: string; runner: Runner; actions: RowMenuActions; onBack: () => void }) {
  const [reason, setReason] = useState<SkipReasonId>(HIDE_REASONS[0]!.id);
  return (
    <>
      <Head id={`va-m-t-${uid}`} title="Не подходит" onBack={onBack} />
      <fieldset className="va-m-b">
        <legend className="vh">Причина</legend>
        <ul className="va-m-opts">
          {HIDE_REASONS.map((entry) => (
            <li key={entry.id}>
              <label className="va-m-opt">
                <input
                  type="radio"
                  name={`va-why-${uid}`}
                  checked={reason === entry.id}
                  onChange={() => setReason(entry.id)}
                />
                <span>{entry.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {runner.error ? <ErrorLine text={runner.error} onRetry={runner.retry} /> : null}
      <div className="va-m-foot">
        <button className="btn is-primary" type="button" disabled={runner.pending} onClick={() => runner.run(() => actions.hide(reason))}>
          {runner.pending ? 'Скрываем…' : 'Скрыть'}
        </button>
      </div>
    </>
  );
}

function AppliedView({ uid, runner, actions, onBack }: { uid: string; runner: Runner; actions: RowMenuActions; onBack: () => void }) {
  const [text, setText] = useState(todayField);
  const [badDate, setBadDate] = useState(false);
  const save = () => {
    const iso = parseShortDate(text);
    setBadDate(iso === null);
    if (iso !== null) runner.run(() => actions.applied(iso));
  };
  return (
    <>
      <Head id={`va-m-t-${uid}`} title="Уже откликнулись" onBack={onBack} />
      <div className="va-m-b">
        <div className="va-m-row">
          <div className="va-m-f is-date">
            <label htmlFor={`va-d-${uid}`}>Дата</label>
            <input
              id={`va-d-${uid}`}
              type="text"
              inputMode="numeric"
              placeholder="дд.мм"
              value={text}
              aria-invalid={badDate || undefined}
              aria-describedby={badDate ? `va-d-e-${uid}` : undefined}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        </div>
        {badDate ? (
          <p className="va-err va-m-err" id={`va-d-e-${uid}`} role="alert">
            <Icon name="warn" />
            Нет такой даты
          </p>
        ) : null}
      </div>
      {runner.error ? <ErrorLine text={runner.error} onRetry={runner.retry} /> : null}
      <div className="va-m-foot">
        <button className="btn is-primary" type="button" disabled={runner.pending} onClick={save}>
          {runner.pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </>
  );
}

/** Единое окно действий строки: список, «Не подходит», «Уже откликнулись». */
export function RowMenu({ item, initialView, actions, onClose }: RowMenuProps) {
  const uid = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MenuView>(initialView);
  const runner = useRunner();
  useMenuDismiss(dialog, view, onClose);
  const name = `${item.cluster.canonicalTitle}, ${item.cluster.canonicalCompany ?? ''}`;
  const label = view === 'list' ? { 'aria-label': `Действия: ${name}` } : { 'aria-labelledby': `va-m-t-${uid}` };
  const back = () => setView('list');
  return (
    <>
      <div className="va-m-back" aria-hidden="true" onClick={onClose} />
      <div ref={dialog} className={`va-pop va-m is-${view}`} id={`va-m-${item.cluster.id}`} role="dialog" tabIndex={-1} {...label}>
        <span className="grab" aria-hidden="true" />
        {view === 'list' ? <ListView item={item} runner={runner} actions={actions} onView={setView} /> : null}
        {view === 'hide' ? <HideView uid={uid} runner={runner} actions={actions} onBack={back} /> : null}
        {view === 'applied' ? <AppliedView uid={uid} runner={runner} actions={actions} onBack={back} /> : null}
      </div>
    </>
  );
}
