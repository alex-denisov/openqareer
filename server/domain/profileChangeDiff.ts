import type { ResumeDraft } from './resumeDraft';

/**
 * Generic «было → стало» for the profile history. A text section stores its
 * text; a list section stores each item as canonical JSON keyed by the item id
 * ('' when the item did not exist), so any list section added to the draft is
 * logged and reverted the same way.
 */
export const TEXT_SECTIONS = ['headline', 'about'] as const;
export const LIST_SECTIONS = [
  'experience',
  'education',
  'projects',
  'certifications',
  'languages',
  'skills',
  'courses',
  'achievements',
] as const;

type TextSection = (typeof TEXT_SECTIONS)[number];
type ListSection = (typeof LIST_SECTIONS)[number];
type ListItem = { readonly id: string } & Record<string, unknown>;

export interface ProfileValueChange {
  readonly section: string;
  readonly itemId: string | null;
  readonly label: string;
  readonly previous: string;
  readonly applied: string;
}

const LABEL_KEYS = ['title', 'name', 'institution', 'qualification', 'employer'] as const;
const SUMMARY_KEYS = [
  'title',
  'employer',
  'name',
  'institution',
  'qualification',
  'issuer',
  'cefr',
  'level',
  'provider',
  'description',
] as const;

const isTextSection = (section: string): section is TextSection =>
  (TEXT_SECTIONS as readonly string[]).includes(section);
const isListSection = (section: string): section is ListSection =>
  (LIST_SECTIONS as readonly string[]).includes(section);

function listOf(draft: ResumeDraft, section: ListSection): readonly ListItem[] {
  return ((draft as unknown as Record<string, unknown>)[section] ?? []) as readonly ListItem[];
}

function canonical(item: ListItem | undefined): string {
  if (!item) return '';
  const sorted = Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

function itemLabel(item: ListItem): string {
  const parts = LABEL_KEYS.map((key) => item[key]).filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return parts.slice(0, 2).join(' · ');
}

function textOf(draft: ResumeDraft, section: TextSection): string {
  return draft.candidate[section] ?? '';
}

/** Every changed text field and list item between two drafts. */
export function diffProfileDrafts(
  previous: ResumeDraft | undefined,
  next: ResumeDraft,
): ProfileValueChange[] {
  const before = previous ?? {
    ...next,
    candidate: {},
    experience: [],
    education: [],
    languages: [],
  };
  const texts = TEXT_SECTIONS.flatMap((section) => {
    const [was, now] = [textOf(before as ResumeDraft, section), textOf(next, section)];
    return was === now ? [] : [{ section, itemId: null, label: '', previous: was, applied: now }];
  });
  const lists = LIST_SECTIONS.flatMap((section) => {
    const oldItems = new Map(listOf(before as ResumeDraft, section).map((item) => [item.id, item]));
    const newItems = new Map(listOf(next, section).map((item) => [item.id, item]));
    const ids = [...new Set([...oldItems.keys(), ...newItems.keys()])];
    return ids.flatMap((id) => {
      const [was, now] = [canonical(oldItems.get(id)), canonical(newItems.get(id))];
      if (was === now) return [];
      const label = itemLabel((newItems.get(id) ?? oldItems.get(id)) as ListItem);
      return [{ section, itemId: id, label, previous: was, applied: now }];
    });
  });
  return [...texts, ...lists];
}

/** The value a history entry compares against; null when the section is unknown. */
export function currentProfileValue(
  draft: ResumeDraft,
  section: string,
  itemId: string | null,
): string | null {
  if (isTextSection(section)) return textOf(draft, section);
  if (!isListSection(section) || !itemId) return null;
  return canonical(listOf(draft, section).find((item) => item.id === itemId));
}

/** Writes a logged value back; '' removes a list item, a missing one is appended. */
export function withProfileValue(
  draft: ResumeDraft,
  section: string,
  itemId: string | null,
  value: string,
): ResumeDraft {
  if (isTextSection(section)) {
    return { ...draft, candidate: { ...draft.candidate, [section]: value } };
  }
  if (!isListSection(section) || !itemId) throw new Error('profile_change_section_unknown');
  const items = listOf(draft, section);
  const restored = value ? (JSON.parse(value) as ListItem) : null;
  const exists = items.some((item) => item.id === itemId);
  const replaced = items.flatMap((item) =>
    item.id !== itemId ? [item] : restored ? [restored] : [],
  );
  const nextItems = exists || !restored ? replaced : [...items, restored];
  return { ...draft, [section]: nextItems } as ResumeDraft;
}

const ABSENT_VALUES = new Set(['', 'null']);
const QUIZ_SOURCE = /квиз|quiz/i;

function parsedItem(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{')) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const textField = (item: Record<string, unknown>, key: string): string =>
  typeof item[key] === 'string' ? (item[key] as string).trim() : '';

/** «Навык ITIL — подтверждён проверкой»: a skill read as a sentence, never as JSON. */
function describeSkill(item: Record<string, unknown>): string {
  const name = textField(item, 'name');
  const status = textField(item, 'status');
  const source = textField(item, 'source');
  const level = textField(item, 'level');
  const sourceText = QUIZ_SOURCE.test(source) ? 'проверкой' : source ? `(${source})` : '';
  const state = [status, status ? sourceText : ''].filter(Boolean).join(' ');
  const details = [state, level ? `уровень ${level}` : ''].filter(Boolean).join(', ');
  return details ? `Навык ${name} — ${details}` : `Навык ${name}`;
}

/** The text a history row shows for one side of a change; '' when there was nothing. */
export function describeSectionValue(section: string, value: string): string {
  if (ABSENT_VALUES.has(value.trim())) return '';
  const item = parsedItem(value);
  if (item && section === 'skills' && textField(item, 'name')) return describeSkill(item);
  return describeProfileValue(value);
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  verifiedAt: 'дата проверки',
  level: 'уровень',
  status: 'статус',
  source: 'источник',
  startDate: 'начало',
  endDate: 'окончание',
};
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T/;

function fieldText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '—';
  const date = ISO_DATE.exec(value);
  return date ? `${date[3]}.${date[2]}` : value.trim();
}

/** Only the fields that differ, as «дата проверки 28.10», one string per side. */
function changedFields(previous: string, applied: string): [string, string] | null {
  const before = parsedItem(previous);
  const after = parsedItem(applied);
  if (!before || !after) return null;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (keys.length === 0) return null;
  const side = (item: Record<string, unknown>) =>
    keys.map((key) => `${FIELD_LABELS[key] ?? key} ${fieldText(item[key])}`).join(', ');
  return [side(before), side(after)];
}

/**
 * Both sides of a history row. When the summaries read the same (a re-check
 * that only moved the date), the row names just the fields that changed.
 */
export function describeSectionChange(
  section: string,
  previous: string,
  applied: string,
): { readonly previousText: string; readonly appliedText: string } {
  const previousText = describeSectionValue(section, previous);
  const appliedText = describeSectionValue(section, applied);
  if (previousText !== appliedText || !previousText) return { previousText, appliedText };
  const fields = changedFields(previous, applied);
  return fields
    ? { previousText: fields[0], appliedText: fields[1] }
    : { previousText, appliedText };
}

/** The display name of a list item from either side of a change, else the fallback. */
export function displayNameOf(previous: string, applied: string, fallback: string): string {
  for (const value of [applied, previous]) {
    const item = parsedItem(value);
    const name = item ? textField(item, 'name') : '';
    if (name) return name;
  }
  return fallback;
}

/** Readable text of a logged value: list items are summarised, text stays as is. */
export function describeProfileValue(value: string): string {
  if (!value.startsWith('{')) return value;
  try {
    const item = JSON.parse(value) as Record<string, unknown>;
    return SUMMARY_KEYS.map((key) => item[key])
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' · ');
  } catch {
    return value;
  }
}
