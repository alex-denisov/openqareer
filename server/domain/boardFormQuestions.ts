import {
  QUESTIONNAIRE_MAX_QUESTIONS,
  type QuestionnaireQuestion,
} from '../../shared/applicationQuestionnaire';
import { clip, isRecord, OPTION_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH } from './questionText';

/** B787: вопросы анкеты из открытых страниц Recruitee и Teamtailor. Ответы площадок — чужие данные. */
const MAX_OPTIONS = 300;
const RECRUITEE_TEXT = new Set(['string', 'text', 'number', 'date', 'salary']);
const CHOICE = new Set(['single_choice', 'multi_choice']);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]{2,6}));/giu,
    (all, dec, hex, name) => {
      const code = dec ? Number(dec) : hex ? Number.parseInt(hex, 16) : 0;
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      return Object.hasOwn(ENTITIES, name ?? '') ? ENTITIES[name] : all;
    },
  );
}

const plain = (html: string, max: number): string =>
  clip(decode(html.replace(/<[^<>]*>/gu, ' ')), max);

/** «Да» и «Нет» на языке вопроса. */
const yesNo = (text: string): readonly string[] =>
  /\p{Script=Cyrillic}/u.test(text) ? ['Да', 'Нет'] : ['Yes', 'No'];

function withChoice(
  base: Pick<QuestionnaireQuestion, 'id' | 'text' | 'required'>,
  labels: readonly string[],
  multiple: boolean,
): QuestionnaireQuestion | null {
  const options = [...new Set(labels.filter(Boolean))].slice(0, MAX_OPTIONS);
  if (options.length === 0) return null;
  return { ...base, kind: 'choice', options, ...(multiple ? { multiple: true } : {}) };
}

function labelsOf(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const label = isRecord(item) ? item[field] : null;
    return typeof label === 'string' ? [plain(label, OPTION_MAX_LENGTH)] : [];
  });
}

function recruiteeQuestion(raw: unknown): QuestionnaireQuestion | null {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.id)) return null;
  if (typeof raw.body !== 'string' || typeof raw.kind !== 'string') return null;
  const text = plain(raw.body, QUESTION_TEXT_MAX_LENGTH);
  if (!text) return null;
  const base = { id: `recruitee_${String(raw.id)}`, text, required: raw.required === true };
  if (RECRUITEE_TEXT.has(raw.kind)) return { ...base, kind: 'text' };
  if (raw.kind === 'boolean') return withChoice(base, yesNo(text), false);
  if (!CHOICE.has(raw.kind)) return null;
  const labels = labelsOf(raw.open_question_options, 'body');
  return withChoice(base, labels, raw.kind === 'multi_choice');
}

/** Вопрос о месте работы живёт отдельно от остальных. */
function recruiteePlace(offer: Record<string, unknown>): QuestionnaireQuestion | null {
  if (offer.location_question_visible !== true && offer.locations_question_visible !== true) {
    return null;
  }
  const text =
    typeof offer.locations_question === 'string'
      ? plain(offer.locations_question, QUESTION_TEXT_MAX_LENGTH)
      : '';
  if (!text) return null;
  const base = {
    id: 'recruitee_locations',
    text,
    required: offer.locations_question_required === true,
  };
  const multiple = offer.locations_question_type === 'multiple_choice';
  return withChoice(base, labelsOf(offer.locations, 'name'), multiple);
}

/** Ответ `/api/offers/<slug>`; не похож на вакансию — `null`. */
export function parseRecruiteeQuestions(
  payload: unknown,
  slug: string,
): readonly QuestionnaireQuestion[] | null {
  const offer = isRecord(payload) ? payload.offer : null;
  if (!isRecord(offer) || offer.slug !== slug || !Array.isArray(offer.open_questions)) return null;
  return [...offer.open_questions.map(recruiteeQuestion), recruiteePlace(offer)]
    .filter((question) => question !== null)
    .slice(0, QUESTIONNAIRE_MAX_QUESTIONS);
}

const QUESTION_START =
  /<input[^<>]*\bvalue="(\d{1,20})"[^<>]*\bname="candidate\[answers_attributes\]\[(\d{1,3})\]\[question_id\]"[^<>]*>/gu;

function teamtailorOptions(block: string): readonly string[] {
  const menu = [...block.matchAll(/\bdata-label-value="([^"<>]*)"/gu)].map((match) =>
    clip(decode(match[1]), OPTION_MAX_LENGTH),
  );
  if (menu.length > 0) return menu;
  return [...block.matchAll(/<label\b[^<>]*>([\s\S]{0,2000}?)<\/label>/gu)].map((match) =>
    plain(match[1], OPTION_MAX_LENGTH),
  );
}

function teamtailorQuestion(
  id: string,
  index: string,
  block: string,
): QuestionnaireQuestion | null {
  const field = new RegExp(
    `<(?:input|textarea|select)[^<>]*\\bname="candidate\\[answers_attributes\\]\\[${index}\\]\\[(text|number|range|date|boolean|choices)\\][^"]*"[^<>]*>`,
    'gu',
  );
  const fields = [...block.matchAll(field)];
  const title = /<(legend|label)\b[^<>]*>([\s\S]{0,4000}?)<\/\1>/u.exec(block);
  if (fields.length === 0 || !title) return null;
  const [name, star] = title[2].split(/<sup\b/u);
  const text = plain(name, QUESTION_TEXT_MAX_LENGTH);
  if (!text) return null;
  const base = { id: `teamtailor_${id}`, text, required: star !== undefined };
  const kind = fields[0][1];
  if (kind !== 'boolean' && kind !== 'choices') return { ...base, kind: 'text' };
  // Варианты стоят между заголовком и концом последнего поля: дальше уже другие части формы.
  const last = fields[fields.length - 1];
  const tail = block.slice(last.index + last[0].length);
  const close = tail.indexOf('</label>');
  const end = last.index + last[0].length + (close < 0 ? 0 : close + '</label>'.length);
  const body = block.slice(title.index + title[0].length, end);
  const multiple = kind === 'choices' && /menuitemcheckbox|type="checkbox"/u.test(body);
  return withChoice(base, teamtailorOptions(body), multiple);
}

/** Страница формы Teamtailor; без формы отклика — `null`. */
export function parseTeamtailorQuestions(
  html: string,
  jobId: string,
): readonly QuestionnaireQuestion[] | null {
  const ours = new RegExp(
    `<input[^<>]*\\bvalue="${jobId}"[^<>]*\\bname="candidate\\[job_applications_attributes\\]\\[0\\]\\[job_id\\]"`,
    'u',
  );
  if (!ours.test(html)) return null;
  const starts = [...html.matchAll(QUESTION_START)];
  return starts
    .flatMap((start, at) => {
      const block = html.slice(start.index + start[0].length, starts[at + 1]?.index);
      return teamtailorQuestion(start[1], start[2], block) ?? [];
    })
    .slice(0, QUESTIONNAIRE_MAX_QUESTIONS);
}
