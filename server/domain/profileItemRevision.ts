import {
  PROFILE_ITEM_FIELDS,
  PROFILE_ITEM_REQUIRED_ON_ADD,
  isProfileItemSection,
  type ProfileItemOperation,
  type ProfileItemSection,
} from '../../shared/profileItemRevision';
import { describeProfileValue } from './profileChangeDiff';
import type { ResumeDraft } from './resumeDraft';

/** The part of a consultant revision that addresses one list item. */
export interface ProfileItemTarget {
  readonly section: string;
  readonly itemId?: string | null;
  readonly operation?: ProfileItemOperation | null;
  readonly itemField?: string | null;
  readonly itemFields?: readonly { readonly field: string; readonly text: string }[] | null;
  readonly proposedText: string;
}

type ListItem = { readonly id: string } & Record<string, unknown>;

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const ACHIEVEMENT_KINDS = ['honor', 'publication', 'patent', 'organization', 'volunteering'];
const DATE_FIELDS = new Set(['startDate', 'endDate', 'issuedAt', 'expiresAt', 'date']);
const DATE_PATTERN = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u;
const LABEL_MAX = 300;
const DESCRIPTION_MAX = 5_000;
// Education and languages always point at a fact; a «manual-» reference makes
// the save path create the candidate's own fact for the new item.
const EVIDENCE_REQUIRED: readonly ProfileItemSection[] = ['education', 'languages'];

function fieldTextIssue(field: string, text: string): string | null {
  if (field === 'cefr') return CEFR.includes(text) ? null : 'cefr must be A1–C2';
  if (field === 'kind') return ACHIEVEMENT_KINDS.includes(text) ? null : 'unknown achievement kind';
  if (DATE_FIELDS.has(field)) {
    return DATE_PATTERN.test(text) ? null : 'item dates are YYYY, YYYY-MM or YYYY-MM-DD';
  }
  const max = field === 'description' ? DESCRIPTION_MAX : LABEL_MAX;
  return text.length <= max ? null : `${field} is longer than ${max}`;
}

function fieldIssue(section: ProfileItemSection, field: string, text: string): string | null {
  const allowed = PROFILE_ITEM_FIELDS[section] as readonly string[];
  if (!allowed.includes(field)) return `${section} has no field ${field}`;
  return fieldTextIssue(field, text.trim());
}

function addIssue(target: ProfileItemTarget, section: ProfileItemSection): string | null {
  if (target.itemId) return 'a new item has no id yet';
  const fields = target.itemFields ?? [];
  if (!fields.length) return 'an added item needs itemFields';
  if (new Set(fields.map((item) => item.field)).size !== fields.length) {
    return 'itemFields repeat a field';
  }
  const missing = PROFILE_ITEM_REQUIRED_ON_ADD[section].find(
    (field) => !fields.some((item) => item.field === field && item.text.trim()),
  );
  if (missing) return `an added ${section} item needs ${missing}`;
  return fields.map((item) => fieldIssue(section, item.field, item.text)).find(Boolean) ?? null;
}

/** Why an item revision cannot be valid, or null; non-item sections must not carry item keys. */
export function profileItemRevisionIssue(target: ProfileItemTarget): string | null {
  const itemKeys = target.itemId || target.operation || target.itemField || target.itemFields;
  if (!isProfileItemSection(target.section)) {
    return itemKeys ? 'only list sections have item targets' : null;
  }
  const section = target.section;
  if (!target.operation) return `${section} revisions need an operation`;
  if (target.operation === 'add') {
    return target.itemField ? 'an added item uses itemFields' : addIssue(target, section);
  }
  if (!target.itemId) return `${section} ${target.operation} needs an itemId`;
  if (target.itemFields?.length) return 'only an added item carries itemFields';
  if (target.operation === 'remove') {
    return target.itemField ? 'a removal has no field' : null;
  }
  if (!target.itemField) return `${section} update needs an itemField`;
  return fieldIssue(section, target.itemField, target.proposedText);
}

function itemsOf(draft: ResumeDraft, section: ProfileItemSection): readonly ListItem[] {
  return ((draft as unknown as Record<string, unknown>)[section] ?? []) as readonly ListItem[];
}

function fieldText(item: ListItem, field: string): string {
  const value = item[field];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** «Python · C1»: what the candidate sees for a whole item. */
export function profileItemSummary(item: Record<string, unknown>): string {
  return describeProfileValue(JSON.stringify(item));
}

/** The text the candidate sees now; null when the item is gone. */
export function currentProfileItemText(
  draft: ResumeDraft,
  target: ProfileItemTarget,
): string | null {
  if (!isProfileItemSection(target.section)) return null;
  if (target.operation === 'add') return target.itemId ? null : '';
  const item = itemsOf(draft, target.section).find((entry) => entry.id === target.itemId);
  if (!item) return null;
  if (target.operation === 'remove') return profileItemSummary(item);
  return target.itemField ? fieldText(item, target.itemField) : null;
}

function withField(item: ListItem, field: string, text: string): ListItem {
  const value = text.trim();
  if (value) return { ...item, [field]: value };
  const { [field]: _removed, ...rest } = item;
  return rest as ListItem;
}

function newItem(section: ProfileItemSection, target: ProfileItemTarget, id: string): ListItem {
  const base: ListItem = EVIDENCE_REQUIRED.includes(section)
    ? { id, evidenceMemoryId: `manual-${id}` }
    : { id };
  return (target.itemFields ?? []).reduce(
    (item, { field, text }) => withField(item, field, text),
    base,
  );
}

/** The draft after the revision and the id of the item it touched. */
export function applyProfileItemRevision(
  draft: ResumeDraft,
  target: ProfileItemTarget,
  newItemId: string,
): { readonly draft: ResumeDraft; readonly itemId: string } {
  if (!isProfileItemSection(target.section)) throw new Error('profile_item_section_unknown');
  const section = target.section;
  const items = itemsOf(draft, section);
  if (target.operation === 'add') {
    const added = newItem(section, target, newItemId);
    return { draft: { ...draft, [section]: [...items, added] } as ResumeDraft, itemId: newItemId };
  }
  const itemId = target.itemId ?? '';
  if (!items.some((item) => item.id === itemId)) throw new Error('profile_item_missing');
  const next =
    target.operation === 'remove'
      ? items.filter((item) => item.id !== itemId)
      : items.map((item) =>
          item.id === itemId ? withField(item, target.itemField ?? '', target.proposedText) : item,
        );
  return { draft: { ...draft, [section]: next } as ResumeDraft, itemId };
}
