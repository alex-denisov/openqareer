import type {
  LinkedinJournalEvent,
  LinkedinJournalKind,
  LinkedinJournalMonth,
  LinkedinJournalPage,
} from '../../shared/b640LinkedinJournal';

/** Публикация из нашего хранения: отметка черновика или строка очереди B694. */
export interface JournalPublication {
  /** Готовый id события: `queue:<id>` или `draft:<id>`. */
  readonly id: string;
  readonly kind: 'post' | 'comment';
  readonly state: 'done' | 'removed';
  readonly text: string;
  /** Когда строка пришла в нынешнее состояние. */
  readonly at: string;
  readonly url: string | null;
}

/** Отметка кандидата «ответил» у контакта (B697). */
export interface JournalReply {
  readonly contactId: string;
  readonly name: string;
  readonly at: string;
}

export interface JournalSources {
  readonly publications: readonly JournalPublication[];
  readonly replies: readonly JournalReply[];
  readonly timezone: string;
  readonly now: Date;
}

function publicationEvent(row: JournalPublication): LinkedinJournalEvent {
  const kind: LinkedinJournalKind =
    row.state === 'removed' ? 'removed' : row.kind === 'post' ? 'post_published' : 'comment_published';
  return { id: row.id, kind, at: row.at, text: row.text, url: row.url, contact: null };
}

function replyEvent(reply: JournalReply): LinkedinJournalEvent {
  const contact = { id: reply.contactId, name: reply.name };
  return { id: `reply:${reply.contactId}`, kind: 'replied', at: reply.at, text: null, url: null, contact };
}

/** `YYYY-MM-01` месяца момента `at` в поясе `timezone`. */
function monthOf(at: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return `${day.slice(0, 7)}-01`;
}

function monthTotals(events: readonly LinkedinJournalEvent[], timezone: string, now: Date): LinkedinJournalMonth {
  const month = monthOf(now, timezone);
  const inMonth = events.filter((event) => monthOf(new Date(event.at), timezone) === month);
  const count = (kind: LinkedinJournalKind) => inMonth.filter((event) => event.kind === kind).length;
  return { month, posts: count('post_published'), comments: count('comment_published'), replies: count('replied') };
}

/** B696: журнал собственных событий LinkedIn — от новых к старым, порциями, с итогами текущего месяца. */
export function buildLinkedinJournal(
  sources: JournalSources,
  page: { readonly offset: number; readonly limit: number },
): LinkedinJournalPage {
  const events = [
    ...sources.publications.map(publicationEvent),
    ...sources.replies.map(replyEvent),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  return {
    events: events.slice(page.offset, page.offset + page.limit),
    total: events.length,
    offset: page.offset,
    limit: page.limit,
    month: monthTotals(events, sources.timezone, sources.now),
  };
}
