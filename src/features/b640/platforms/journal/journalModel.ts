import type { LinkedinJournalEvent, LinkedinJournalMonth } from '../../../../../shared/b640LinkedinJournal';
import { dativeNameRu } from '../../../today/dativeNameRu';
import { formatWhen } from '../format';

export interface JournalRowView {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly tag: { readonly text: string; readonly ok: boolean };
}

const quoted = (text: string | null): string => (text ? `«${text}»` : '');

function title(event: LinkedinJournalEvent): string {
  if (event.kind === 'replied') return `${event.contact?.name ?? 'Контакт'} ответил`;
  if (event.kind === 'post_published') return 'Пост опубликован';
  if (event.kind === 'comment_published') return 'Комментарий опубликован';
  return 'Убрано из очереди';
}

const TAG: Readonly<Record<LinkedinJournalEvent['kind'], JournalRowView['tag']>> = {
  replied: { text: 'ответил', ok: true },
  post_published: { text: 'опубликован', ok: false },
  comment_published: { text: 'опубликован', ok: false },
  removed: { text: 'убран', ok: false },
};

/** Строка журнала a05c: что было, текст публикации и когда; реакций и ответов LinkedIn не читаем. */
export function journalRow(event: LinkedinJournalEvent): JournalRowView {
  const sub = [quoted(event.text), formatWhen(event.at) ?? ''].filter(Boolean).join(' · ');
  return { id: event.id, title: title(event), sub, tag: TAG[event.kind] };
}

/** Последний «ответил» на первой странице — он ведёт экран (секция `lead` макета). */
export function leadReply(events: readonly LinkedinJournalEvent[]): { readonly id: string; readonly name: string } | null {
  return events.find((event) => event.kind === 'replied')?.contact ?? null;
}

/** Беглая гласная: «Павел» → «Павлу», которых общий склонятель не знает. */
const FLEETING: Readonly<Record<string, string>> = { Павел: 'Павлу', Лев: 'Льву', Пётр: 'Петру' };

/** «Павел» → «Павлу»: имя в дательном для «Написать …». */
export function givenNameDative(fullName: string): string {
  const given = fullName.trim().split(/\s+/u)[0] ?? '';
  return FLEETING[given] ?? dativeNameRu(`${given} Иванов`).split(' ')[0] ?? given;
}

export const givenName = (fullName: string): string => fullName.trim().split(/\s+/u)[0] ?? fullName;

const MONTH = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });

/** «За ноябрь»: месяц итогов в именительном (все месяцы мужского рода, «за» его не меняет). */
export function monthTitle(month: LinkedinJournalMonth): string {
  const date = new Date(`${month.month}T12:00:00Z`);
  const name = Number.isNaN(date.getTime()) ? '' : MONTH.format(date);
  return name ? `За ${name}` : 'За месяц';
}

export interface JournalTotal {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

/** Итоги месяца: посты, комментарии, ответы; реакций LinkedIn не читаем — строки нет. */
export function journalTotals(month: LinkedinJournalMonth): readonly JournalTotal[] {
  return [
    { id: 'posts', label: 'Посты', value: month.posts },
    { id: 'comments', label: 'Комментарии', value: month.comments },
    { id: 'replies', label: 'Ответы', value: month.replies },
  ];
}
