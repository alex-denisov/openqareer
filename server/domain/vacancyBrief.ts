import type { VacancyBrief } from '../../shared/vacancyBrief';
import { headingOf, type Section } from './vacancyRequirementDuty';
import { vacancySourceText } from './vacancyRequirements';

/** Строк каждого раздела хватает, чтобы клиент взял три после сверки с профилем. */
const MAX_LINES = 12;
const MIN_LINE_CHARS = 3;
const MAX_LINE_CHARS = 400;
const OPENING_CHARS = 280;
const MIN_PARAGRAPH_CHARS = 40;
const MIN_ITEMS_IN_RUN_ON = 2;
const BULLET = /^\s*(?:[-–—*•▪●○◦·✔✅➤►]+|\d+[.)])\s*/u;
const MARKDOWN_HEADING = /^(?:#{1,6}\s*)?(?:\*\*|__)?(.+?)(?:\*\*|__)?:?$/u;
const MARKDOWN = /\*\*|__|^#{1,6}\s+/gu;
const LINK = /\[([^\]]+)\]\([^)\s]*\)/gu;
const LETTER = /\p{L}/u;
const RUN_ON =
  /(^|[.;!?»)])[ \t]*((?:обязанности|задачи|основные задачи|что предстоит делать|чем предстоит заниматься|требования|что мы ожидаем|мы ожидаем|условия|мы предлагаем|что мы предлагаем|о компании|responsibilities|key responsibilities|requirements|qualifications|preferred qualifications|what you(?:'|’)ll do|what we offer|benefits)\s*[:：])[ \t]*/gimu;
/** Разделы, которых процент не различает: подпись раздела карточки от этого не меняется. */
const EXTRA_DUTY =
  /^(?:(?:the |about the )?(?:role|job)(?: overview)? (?:responsibilities|duties)|essential (?:duties|functions)|(?:primary|principal|major|essential|general) (?:responsibilities|duties|functions|accountabilities)|job duties|day[- ]to[- ]day|what(?:'|’)s the job|какие задачи|твои задачи|вам предстоит|предстоит|вы будете|что делать|что ты будешь делать|чем ты будешь|чем заниматься|ключевые цели|(?:основной )?функционал)(?!\p{L})/iu;
const EXTRA_REQUIREMENT =
  /^(?:must[- ]haves?|nice to haves?|minimum (?:requirements|experience)|(?:required|preferred|desired|additional) (?:experience|education|knowledge|qualifications|skills)|education (?:and|&|\/) experience|experience (?:and|&) (?:skills|qualifications)|knowledge, skills|job requirements|ideal candidate|the ideal candidate|what you(?:(?:'|’)ll)? bring|what we need|candidate (?:profile|requirements)|наши ожидания|ожидания|ожидаем|пожелания|(?:основные |ключевые |обязательные )требования|будет плюсом|как плюс|кого мы ищем|кто нам нужен|что важно|для нас важно|необходимые)(?!\p{L})/iu;
const EXTRA_OTHER =
  /^(?:about (?:the )?(?:company|role|job|team|position)|who we are|our (?:company|benefits|values|culture)|salary|pay|location|schedule|equal|eeo|job type|work location|additional information|how to apply|о (?:нас|вакансии|роли|команде|проекте)|что предлагаем|мы предлагаем|у нас|бонусы|почему|контакты|график)(?!\p{L})/iu;

/** Заголовок необычный («Show us what you've got! (aka requirements)»), но раздел назван в нём самом. */
const NAMES_DUTY =
  /responsibilit|(?:key|job|core) duties|your mission|обязанност|(?:ваши|какие|круг) задач/iu;
const NAMES_REQUIREMENT =
  /requirements|qualifications|if you have|perfect match|what you bring|требовани|преимуществом|поможет вам|квалификаци/iu;
const MAX_HEADING_CHARS = 70;
/** Подзаголовок внутри раздела («Strategy & Leadership») — не пункт. */
const MAX_SUBHEADING_CHARS = 60;
/** Площадка отдала не текст, а строку «Должность — Компания — Город». */
const MIN_TEXT_CHARS = 140;

interface Line {
  readonly text: string;
  readonly bulleted: boolean;
  readonly section: Section | null;
}

function cleaned(line: string): string {
  return line
    .replace(LINK, '$1')
    .replace(BULLET, '')
    .replace(MARKDOWN, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function headingSection(line: string): Section | null {
  const marked = MARKDOWN_HEADING.exec(line.trim())?.[1]?.trim() ?? '';
  const isMarked = /^(?:#{1,6}\s|\*\*|__)/u.test(line.trim());
  if (!marked || marked.length > MAX_HEADING_CHARS || (BULLET.test(line) && !isMarked)) return null;
  if (EXTRA_OTHER.test(marked)) return 'other';
  if (EXTRA_DUTY.test(marked)) return 'duty';
  if (EXTRA_REQUIREMENT.test(marked)) return 'requirement';
  // Обычное предложение («Experience with Go is needed.») начинается как заголовок, но кончается точкой.
  if (/[.;,]$/u.test(line.trim())) return null;
  if (NAMES_DUTY.test(marked)) return 'duty';
  if (NAMES_REQUIREMENT.test(marked)) return 'requirement';
  return headingOf(isMarked ? `${marked}:` : line);
}

/** «Задачи: вести команду; нанимать» одной строкой — по пунктам; пункт с переносом не режется. */
function items(line: string): readonly string[] {
  const text = cleaned(line);
  const pieces = text.split(/\s*[;•]\s*/u).filter((piece) => piece.length >= MIN_LINE_CHARS);
  return pieces.length >= MIN_ITEMS_IN_RUN_ON ? pieces : [text];
}

function linesOf(description: string): readonly Line[] {
  const text = vacancySourceText(description).replace(RUN_ON, '$1\n$2\n');
  let section: Section | null = null;
  return text.split('\n').flatMap((line): readonly Line[] => {
    if (!LETTER.test(line)) return [];
    const heading = headingSection(line);
    if (heading) {
      section = heading;
      return [];
    }
    const pieces = items(line);
    const bulleted = BULLET.test(line) || pieces.length > 1;
    return pieces.map((item) => ({ text: item, section, bulleted }));
  });
}

const isItem = (text: string): boolean =>
  text.length >= MIN_LINE_CHARS && text.length <= MAX_LINE_CHARS && !/[:：]$/u.test(text);

const looksLikeSubheading = ({ text, bulleted }: Line): boolean =>
  !bulleted && text.length <= MAX_SUBHEADING_CHARS && !/[.;,!]$/u.test(text);

function ofSection(lines: readonly Line[], section: Section): readonly string[] {
  const own = lines.filter((line) => line.section === section && isItem(line.text));
  const sure = own.filter((line) => !looksLikeSubheading(line));
  // Весь раздел короткими строками без маркеров — это и есть пункты.
  const items = sure.length > 0 ? sure : own;
  return [...new Set(items.map(({ text }) => text.replace(/[.;,]+$/u, '')))].slice(0, MAX_LINES);
}

const paragraphsOf = (description: string): readonly string[] =>
  vacancySourceText(description)
    .split('\n')
    .map(cleaned)
    .filter((line) => LETTER.test(line));

/** Первые предложения текста, целиком; одно очень длинное — до слова. */
function openingOf(paragraphs: readonly string[]): string {
  const long = paragraphs.filter((line) => line.length >= MIN_PARAGRAPH_CHARS);
  const text = (long.length > 0 ? long : paragraphs).join(' ');
  if (text.length <= OPENING_CHARS) return text;
  const cut = text.slice(0, OPENING_CHARS);
  const end = Math.max(...['. ', '! ', '? '].map((mark) => cut.lastIndexOf(mark)));
  return end >= MIN_PARAGRAPH_CHARS
    ? cut.slice(0, end + 1)
    : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** B791: краткое содержание вакансии её же строками, правилами, без модели. */
export function vacancyBrief(description: string): VacancyBrief | undefined {
  const paragraphs = paragraphsOf(description);
  const opening = openingOf(paragraphs);
  const isStub =
    paragraphs.length < 2 && opening.length < MIN_TEXT_CHARS && !/[.!?;](?:\s|$)/u.test(opening);
  if (isStub) return undefined;
  const lines = linesOf(description);
  return {
    duties: ofSection(lines, 'duty'),
    requirements: ofSection(lines, 'requirement'),
    opening,
  };
}
