import {
  QUESTIONNAIRE_MAX_QUESTIONS,
  type QuestionnaireQuestion,
} from '../../shared/applicationQuestionnaire';
import { plain, withChoice, type ParsedQuestion } from './boardFormText';
import { isRecord, OPTION_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH } from './questionText';
import { teamtailorQuestions } from './teamtailorForm';

/** B787: вопросы анкеты из открытых страниц Recruitee и Teamtailor. Ответы площадок — чужие данные. */
const RECRUITEE_TEXT = new Set(['string', 'text', 'number', 'date', 'salary']);
const CHOICE = new Set(['single_choice', 'multi_choice']);

/** «Да» и «Нет» на языке вопроса. */
const yesNo = (text: string): readonly string[] =>
  /\p{Script=Cyrillic}/u.test(text) ? ['Да', 'Нет'] : ['Yes', 'No'];

/** Обязательный вопрос без текстового ответа (файл, видео): анкета неполная и готовой не считается. */
function complete(parsed: readonly ParsedQuestion[]): readonly QuestionnaireQuestion[] | null {
  const known = parsed.filter((item) => item !== null && item !== 'required_unknown');
  if (parsed.includes('required_unknown') || known.length > QUESTIONNAIRE_MAX_QUESTIONS)
    return null;
  return known;
}

function labelsOf(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const label = isRecord(item) ? item[field] : null;
    return typeof label === 'string' ? [plain(label, OPTION_MAX_LENGTH)] : [];
  });
}

function recruiteeQuestion(raw: unknown): ParsedQuestion {
  if (!isRecord(raw)) return null;
  const unknown = raw.required === true ? 'required_unknown' : null;
  if (!Number.isSafeInteger(raw.id)) return unknown;
  if (typeof raw.body !== 'string' || typeof raw.kind !== 'string') return unknown;
  const text = plain(raw.body, QUESTION_TEXT_MAX_LENGTH);
  if (!text) return unknown;
  const base = { id: `recruitee_${String(raw.id)}`, text, required: raw.required === true };
  if (RECRUITEE_TEXT.has(raw.kind)) return { ...base, kind: 'text' };
  if (raw.kind === 'boolean') return withChoice(base, yesNo(text), false);
  if (!CHOICE.has(raw.kind)) return unknown;
  const labels = labelsOf(raw.open_question_options, 'body');
  return withChoice(base, labels, raw.kind === 'multi_choice') ?? unknown;
}

/** Вопрос о месте работы живёт отдельно от остальных. */
function recruiteePlace(offer: Record<string, unknown>): ParsedQuestion {
  if (offer.location_question_visible !== true && offer.locations_question_visible !== true) {
    return null;
  }
  const text =
    typeof offer.locations_question === 'string'
      ? plain(offer.locations_question, QUESTION_TEXT_MAX_LENGTH)
      : '';
  const unknown = offer.locations_question_required === true ? 'required_unknown' : null;
  if (!text) return unknown;
  const base = {
    id: 'recruitee_locations',
    text,
    required: offer.locations_question_required === true,
  };
  const multiple = offer.locations_question_type === 'multiple_choice';
  return withChoice(base, labelsOf(offer.locations, 'name'), multiple) ?? unknown;
}

/** Ответ `/api/offers/<slug>`; не похож на вакансию — `null`. */
export function parseRecruiteeQuestions(
  payload: unknown,
  slug: string,
): readonly QuestionnaireQuestion[] | null {
  const offer = isRecord(payload) ? payload.offer : null;
  if (!isRecord(offer) || offer.slug !== slug || !Array.isArray(offer.open_questions)) return null;
  return complete([...offer.open_questions.map(recruiteeQuestion), recruiteePlace(offer)]);
}

/** Страница формы Teamtailor; без формы отклика — `null`. */
export function parseTeamtailorQuestions(
  html: string,
  jobId: string,
): readonly QuestionnaireQuestion[] | null {
  const parsed = teamtailorQuestions(html, jobId);
  return parsed && complete(parsed);
}
