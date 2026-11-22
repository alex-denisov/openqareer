import { STAR_FIELDS } from '../../../../../shared/starStories';
import type { PrepParagraph, PrepQuestion } from './prepModel';

/** «Памятка к интервью»: собрана из сохранённой подготовки, без модели и шаблонов. */
export interface MemoInput {
  readonly title: string;
  readonly meta: readonly string[];
  readonly questions: readonly PrepQuestion[];
  readonly paragraphs: readonly PrepParagraph[];
  /** «от 500 000 ₽» из профиля; `null` — планки нет. */
  readonly floor: string | null;
  readonly askThem: readonly string[];
}

export interface MemoItem {
  readonly title: string;
  readonly text: string | null;
}

export interface MemoSection {
  readonly title: string;
  readonly items: readonly MemoItem[];
}

export interface Memo {
  readonly title: string;
  readonly meta: readonly string[];
  readonly sections: readonly MemoSection[];
}

function answerText(questionId: string, paragraphs: readonly PrepParagraph[]): string {
  const own = paragraphs.filter((item) => item.questionId === questionId);
  const ordered = STAR_FIELDS.flatMap((field) =>
    own.filter((item) => item.field === field).map((item) => item.text.trim()),
  ).filter(Boolean);
  return ordered.length > 0 ? ordered.join(' ') : 'Ответа пока нет';
}

export function buildMemo(input: MemoInput): Memo {
  const sections: MemoSection[] = [];
  if (input.questions.length > 0) {
    sections.push({
      title: 'Ответы',
      items: input.questions.map((question) => ({
        title: question.question,
        text: answerText(question.id, input.paragraphs),
      })),
    });
  }
  if (input.floor) {
    sections.push({ title: 'Ожидания по зарплате', items: [{ title: input.floor, text: null }] });
  }
  if (input.askThem.length > 0) {
    sections.push({
      title: 'Спросите сами',
      items: input.askThem.map((question) => ({ title: question, text: null })),
    });
  }
  return { title: input.title, meta: input.meta, sections };
}

function sectionText(section: MemoSection): string {
  const items = section.items.map((item) =>
    item.text ? `${item.title}\n${item.text}` : `— ${item.title}`,
  );
  return [section.title, ...items].join('\n');
}

/** Текст для «Скопировать»: шапка интервью, затем разделы через пустую строку. */
export function memoText(memo: Memo): string {
  const head = [memo.title, memo.meta.join(' · ')].filter(Boolean).join('\n');
  return [head, ...memo.sections.map(sectionText)].join('\n\n');
}
