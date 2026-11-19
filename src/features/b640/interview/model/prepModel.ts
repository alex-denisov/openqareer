import { pluralRu } from '../../../../../shared/pluralRu';
import { STAR_FIELDS, type StarStoryView } from '../../../../../shared/starStories';

/** Абзац подготовки (`/applications/:id/star-prep`): ответ на вопрос по полю STAR. */
export interface PrepParagraph {
  readonly questionId: string;
  readonly field: (typeof STAR_FIELDS)[number];
  readonly text: string;
  readonly sourceFactId: string;
}

export interface PrepQuestion {
  readonly id: string;
  readonly question: string;
}

export interface PrepRow {
  readonly id: string;
  readonly title: string;
  readonly ready: boolean;
  readonly sub: string;
}

interface ResponseLike {
  readonly id: string;
  readonly stage: string;
  readonly nearestInterview: { readonly scheduledAt: string | null } | null;
}

/** «Подготовка» без отклика в адресе: ближайшее будущее интервью, иначе первый отклик на этапе интервью. */
export function pickNextResponse<T extends ResponseLike>(apps: readonly T[], now: Date): T | null {
  const upcoming = apps
    .filter((item) => {
      const at = item.nearestInterview?.scheduledAt;
      return at ? Date.parse(at) >= now.getTime() : false;
    })
    .sort(
      (a, b) =>
        Date.parse(a.nearestInterview?.scheduledAt ?? '') -
        Date.parse(b.nearestInterview?.scheduledAt ?? ''),
    );
  return upcoming[0] ?? apps.find((item) => item.stage === 'interview') ?? null;
}

/** Пример из STAR-истории: четыре абзаца с фактом-источником; без факта ответ не собрать. */
export function paragraphsFromStory(
  questionId: string,
  story: StarStoryView,
): readonly PrepParagraph[] | null {
  const sourceFactId = story.sourceFactIds[0];
  if (!sourceFactId) return null;
  return STAR_FIELDS.filter((field) => story.fields[field].trim()).map((field) => ({
    questionId,
    field,
    text: story.fields[field].trim(),
    sourceFactId,
  }));
}

export function replaceQuestionParagraphs(
  current: readonly PrepParagraph[],
  questionId: string,
  next: readonly PrepParagraph[],
): readonly PrepParagraph[] {
  return [...current.filter((item) => item.questionId !== questionId), ...next];
}

function exampleTitle(
  paragraphs: readonly PrepParagraph[],
  stories: readonly StarStoryView[],
): string | null {
  const situation = paragraphs.find((item) => item.field === 'situation')?.text;
  if (!situation) return null;
  return stories.find((story) => story.fields.situation.trim() === situation)?.title ?? null;
}

export function buildPrepRows(
  questions: readonly PrepQuestion[],
  paragraphs: readonly PrepParagraph[],
  stories: readonly StarStoryView[],
): readonly PrepRow[] {
  return questions.map((question) => {
    const own = paragraphs.filter((item) => item.questionId === question.id);
    if (own.length === 0) {
      return { id: question.id, title: question.question, ready: false, sub: 'Ответа пока нет' };
    }
    const example = exampleTitle(own, stories);
    return {
      id: question.id,
      title: question.question,
      ready: true,
      sub: example ? `Ответ готов · пример: ${example}` : 'Ответ готов',
    };
  });
}

export function prepHeadline(ready: number, total: number): string {
  const verb = ready % 10 === 1 && ready % 100 !== 11 ? 'Готов ответ' : 'Готовы ответы';
  return `${verb} на ${pluralRu(ready, ['вопрос', 'вопроса', 'вопросов'])} из ${total}`;
}

/** «12 ноября, 15:00» в часовом поясе кандидата. */
export function formatInterviewWhen(iso: string | null, timeZone?: string): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}
