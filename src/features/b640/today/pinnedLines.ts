import { pluralWordRu } from '../../../../shared/pluralRu';
import { buildNodePath } from '../routes';
import type { B640Notification } from './b640NotificationsApi';
import { pinnedAction, pinnedTitle, type PinnedAction } from './feedModel';

/** Строка блока «Важно»: одно событие или сводка входов на площадки. */
export interface PinnedLine {
  readonly key: string;
  readonly items: readonly B640Notification[];
  readonly title: string;
  /** Что входит в сводку: «hh.ru, Ладога Банк»; у одиночной строки нет. */
  readonly detail: string | null;
  readonly action: PinnedAction;
}

const HH_SESSION_SOURCE = 'hh_session';

function needsLogin(item: B640Notification): boolean {
  return (
    item.kind === 'platform_login_required' ||
    (item.kind === 'delivery_error' && item.sourceType === HH_SESSION_SOURCE)
  );
}

function loginName(item: B640Notification): string | null {
  return item.sourceType === HH_SESSION_SOURCE ? 'hh.ru' : item.company;
}

function singleLine(item: B640Notification): PinnedLine {
  return {
    key: item.id,
    items: [item],
    title: pinnedTitle(item),
    detail: null,
    action: pinnedAction(item),
  };
}

const OTHER_CONNECTION = 'другое подключение';

/** Список сводки: каждая площадка один раз, события без площадки — одной строкой. */
function loginNames(items: readonly B640Notification[]): readonly string[] {
  const names = items.map(loginName);
  const known = [...new Set(names.filter((name): name is string => !!name))];
  return names.some((name) => !name) ? [...known, OTHER_CONNECTION] : known;
}

/** Число в заголовке — длина списка внутри: два события hh.ru — одно подключение. */
function loginSummary(items: readonly B640Notification[]): PinnedLine {
  const names = loginNames(items);
  const count = names.length;
  const forms: [string, string, string] = [
    'подключение требует входа',
    'подключения требуют входа',
    'подключений требуют входа',
  ];
  return {
    key: `login:${items.map((item) => item.id).join(',')}`,
    items,
    title: `${count} ${pluralWordRu(count, forms)}`,
    detail: names.join(', '),
    action: { label: 'Подключить', path: buildNodePath('n03'), icon: 'refresh' },
  };
}

/**
 * n01b «Важно»: два и больше входа на площадки — одна строка «2 подключения требуют входа»
 * со списком внутри и «Подключить»; она стоит на месте первого из них.
 */
export function pinnedLines(pinned: readonly B640Notification[]): readonly PinnedLine[] {
  const logins = pinned.filter(needsLogin);
  if (logins.length < 2) return pinned.map(singleLine);
  const firstLogin = logins[0]!;
  return pinned.flatMap((item) => {
    if (!needsLogin(item)) return [singleLine(item)];
    return item === firstLogin ? [loginSummary(logins)] : [];
  });
}
