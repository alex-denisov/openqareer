import { plain, withChoice, type ParsedQuestion } from './boardFormText';
import { OPTION_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH } from './questionText';

/**
 * B787: вопросы страницы Teamtailor. Страница чужая: теги читаются одним проходом по тексту,
 * без регулярных выражений по всей странице.
 */
const MAX_PAGE = 400_000;
const MAX_TAG = 20_000;
const MAX_TEXT = 4_000;
const NEAR_TAGS = 200;
const MAX_LABELS = 300;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/gu;
const WANTED = new Set([
  'input',
  'textarea',
  'select',
  'legend',
  'label',
  'sup',
  'div',
  'span',
  'button',
]);
const ANSWER_NAME = /^candidate\[answers_attributes\]\[(\d{1,3})\]\[(\w{1,60})\]/u;
const TEXT_FIELDS = new Set(['text', 'number', 'range', 'date']);
const CHOICE_FIELDS = new Set(['boolean', 'choices']);
const JOB_NAME = 'candidate[job_applications_attributes][0][job_id]';

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
  readonly start: number;
  readonly end: number;
}

function tagAt(html: string, start: number, end: number): Tag | null {
  const raw = html.slice(start + 1, Math.min(end, start + 1 + MAX_TAG));
  const head = /^(\/?)([a-z]{1,12})(?=[\s/]|$)/iu.exec(raw);
  const name = head?.[2].toLowerCase() ?? '';
  if (!head || !WANTED.has(name)) return null;
  const pairs = [...raw.matchAll(ATTRIBUTE)].map((pair) => [pair[1], pair[2]] as const);
  return { name, closing: head[1] === '/', attributes: new Map(pairs), start, end: end + 1 };
}

/** Теги по порядку; незакрытый тег обрывает чтение. */
function tagsOf(html: string): readonly Tag[] {
  const tags: Tag[] = [];
  let start = html.indexOf('<');
  while (start >= 0) {
    const end = html.indexOf('>', start);
    if (end < 0) break;
    const tag = tagAt(html, start, end);
    if (tag) tags.push(tag);
    start = html.indexOf('<', end);
  }
  return tags;
}

interface Block {
  readonly id: string;
  readonly index: string;
  readonly mandatory: boolean;
  readonly tags: readonly Tag[];
}

const fieldOf = (tag: Tag): { index: string; field: string } | null => {
  const match = ANSWER_NAME.exec(tag.attributes.get('name') ?? '');
  return match && !tag.closing ? { index: match[1], field: match[2] } : null;
};

function blocksOf(tags: readonly Tag[]): readonly Block[] {
  const starts = tags.flatMap((tag, at) => {
    const found = fieldOf(tag);
    const id = tag.attributes.get('value') ?? '';
    return found?.field === 'question_id' && /^\d{1,20}$/u.test(id)
      ? [{ id, index: found.index, at }]
      : [];
  });
  return starts.map(({ id, index, at }, order) => ({
    id,
    index,
    mandatory: tags[at - 1]?.attributes.get('data-question-mandatory') === 'true',
    tags: tags.slice(at + 1, starts[order + 1]?.at),
  }));
}

/** Текст до закрывающего тега того же имени; у заголовка — до звёздочки обязательности. */
function textAfter(html: string, tags: readonly Tag[], at: number, stopAtSup: boolean): string {
  const open = tags[at];
  const until = tags
    .slice(at + 1, at + NEAR_TAGS)
    .find((tag) => (tag.closing && tag.name === open.name) || (stopAtSup && tag.name === 'sup'));
  const end = Math.min(until?.start ?? open.end, open.end + MAX_TEXT);
  return plain(html.slice(open.end, end), stopAtSup ? QUESTION_TEXT_MAX_LENGTH : OPTION_MAX_LENGTH);
}

function hasSup(tags: readonly Tag[], at: number): boolean {
  const close = tags.findIndex(
    (tag, place) => place > at && tag.closing && tag.name === tags[at].name,
  );
  return tags.slice(at, close < 0 ? at : close).some((tag) => tag.name === 'sup');
}

function optionsOf(html: string, tags: readonly Tag[], fields: readonly Tag[]): readonly string[] {
  const menu = tags.flatMap((tag) => tag.attributes.get('data-label-value') ?? []);
  if (menu.length > 0) return menu.map((label) => plain(label, OPTION_MAX_LENGTH));
  const ids = new Set(fields.flatMap((tag) => tag.attributes.get('id') ?? []));
  const labels = tags.flatMap((tag, at) => {
    const target = tag.attributes.get('for');
    return tag.name === 'label' && !tag.closing && target && ids.has(target) ? [at] : [];
  });
  return labels.slice(0, MAX_LABELS).map((at) => textAfter(html, tags, at, false));
}

function questionOf(html: string, { id, index, mandatory, tags }: Block): ParsedQuestion {
  const titleAt = tags.findIndex(
    (tag) => !tag.closing && (tag.name === 'legend' || tag.name === 'label'),
  );
  const required = mandatory || (titleAt >= 0 && hasSup(tags, titleAt));
  const unknown = required ? 'required_unknown' : null;
  const ours = tags.filter((tag) => fieldOf(tag)?.index === index);
  const answers = ours.filter((tag) => {
    const field = fieldOf(tag)?.field ?? '';
    return TEXT_FIELDS.has(field) || CHOICE_FIELDS.has(field);
  });
  const text = titleAt >= 0 ? textAfter(html, tags, titleAt, true) : '';
  if (answers.length === 0 || !text) return unknown;
  const base = { id: `teamtailor_${id}`, text, required };
  const kind = fieldOf(answers[0])?.field ?? '';
  if (TEXT_FIELDS.has(kind)) return { ...base, kind: 'text' };
  const multiple =
    kind === 'choices' &&
    tags.some(
      (tag) =>
        tag.attributes.get('role') === 'menuitemcheckbox' ||
        (answers.includes(tag) && tag.attributes.get('type') === 'checkbox'),
    );
  return withChoice(base, optionsOf(html, tags, answers), multiple) ?? unknown;
}

/** Страница формы; другая вакансия или слишком большая страница — `null`. */
export function teamtailorQuestions(html: string, jobId: string): readonly ParsedQuestion[] | null {
  if (html.length > MAX_PAGE) return null;
  const tags = tagsOf(html);
  const ours = tags.some(
    ({ attributes }) => attributes.get('name') === JOB_NAME && attributes.get('value') === jobId,
  );
  const blocks = blocksOf(tags);
  return ours && blocks.length <= 100 ? blocks.map((block) => questionOf(html, block)) : null;
}
