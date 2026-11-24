import { pluralRu } from '../../../../shared/pluralRu';
import type {
  ProfileHistoryItem,
  ProfileHistorySource,
  ProfileHistorySources,
} from '../../resume/profileHistoryApi';

export function historyHeading(total: number): string {
  return total > 0
    ? pluralRu(total, ['правка профиля', 'правки профиля', 'правок профиля'])
    : 'Правок пока нет';
}

export interface SourceChip {
  readonly source: ProfileHistorySource | undefined;
  readonly label: string;
}

/** Чипы источника с правками; чипа «Из LinkedIn» нет: журнал не различает импорт LinkedIn, hh и файла. */
export function sourceChips(sources: ProfileHistorySources | undefined): SourceChip[] {
  if (!sources) return [];
  const chips: Array<readonly [ProfileHistorySource, string]> = [
    ['candidate', 'С ваших слов'],
    ['consultant', 'Консультант'],
  ];
  return [
    { source: undefined, label: `Все · ${sources.all}` },
    ...chips
      .filter(([source]) => sources[source] > 0)
      .map(([source, name]) => ({ source, label: `${name} · ${sources[source]}` })),
  ];
}

const SOURCE: Record<ProfileHistoryItem['actor'], string> = {
  candidate: 'вы',
  consultant: 'консультант',
  import: 'импорт',
  skill_check: 'проверка навыков',
};

export function sourceLabel(actor: ProfileHistoryItem['actor']): string {
  return SOURCE[actor] ?? 'вы';
}

/** Разделы журнала вне профиля: статус, фото и доход правят на своих экранах. */
const OWN_SCREEN_SECTIONS: ReadonlySet<string> = new Set(['status', 'photo', 'income']);

/**
 * «Отменить» есть у неотменённой правки профиля. Смену статуса возвращает
 * «Вернуть прежний» на «Сегодня», фото и доход меняют там же, где задают.
 */
export function canRevert(entry: ProfileHistoryItem): boolean {
  return entry.revertedAt === null && !OWN_SCREEN_SECTIONS.has(entry.section);
}

/** «Вернуть» есть у отменённой правки значения профиля: её можно применить снова. */
export function canReapply(entry: ProfileHistoryItem): boolean {
  return (
    entry.revertedAt !== null && entry.kind === 'value' && !OWN_SCREEN_SECTIONS.has(entry.section)
  );
}

export interface HistoryRow {
  readonly id: string;
  readonly what: string;
  readonly source: string;
  readonly was: string;
  readonly now: string;
  readonly reverted: boolean;
  readonly revertable: boolean;
  readonly reappliable: boolean;
}

export interface HistoryDay {
  readonly key: string;
  /** «12 ноября». */
  readonly label: string;
  readonly rows: readonly HistoryRow[];
}

function rowOf(entry: ProfileHistoryItem): HistoryRow {
  return {
    id: entry.id,
    what: entry.label,
    source: sourceLabel(entry.actor),
    was: entry.previousText.trim() || '—',
    now: entry.appliedText.trim() || '—',
    reverted: entry.revertedAt !== null,
    revertable: canRevert(entry),
    reappliable: canReapply(entry),
  };
}

/** Правки по дням кандидата в том порядке, в каком их отдал сервер (новые первыми). */
export function historyDays(
  entries: readonly ProfileHistoryItem[],
  timeZone: string,
): HistoryDay[] {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone });
  const label = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone });
  const days: HistoryDay[] = [];
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const dayKey = Number.isNaN(date.getTime()) ? 'unknown' : key.format(date);
    const last = days.at(-1);
    if (last && last.key === dayKey) {
      days[days.length - 1] = { ...last, rows: [...last.rows, rowOf(entry)] };
    } else {
      days.push({
        key: dayKey,
        label: dayKey === 'unknown' ? 'Дата неизвестна' : label.format(date),
        rows: [rowOf(entry)],
      });
    }
  }
  return days;
}
