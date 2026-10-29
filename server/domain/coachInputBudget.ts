import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
import type { CoachTurnInput } from './coach';
import { serializeCoachInput } from './coachInputSerialization';

/**
 * Потолок входа хода консультанта (B580): 16K вместо прежних 30–37K. В ход
 * идут сводки закрытых бесед и последние реплики, а не вся история.
 */
export const COACH_TURN_INPUT_TOKEN_LIMIT = 16_000;
/** Сколько последних реплик держим, пока есть что урезать кроме них. */
const RECENT_MESSAGES = 8;
/** Меньше — и модель теряет нить разговора; дальше урезаются сводки и рынок. */
const MIN_MESSAGES = 4;
const MIN_SUMMARIES = 2;
const MIN_MARKET = 4;
const DOCUMENT_EXCERPT_CHARS = 1_500;

/** Оценка сверху: 4 байта на токен, для кириллицы токенизаторы дают меньше. */
export function estimateCoachTurnTokens(input: CoachTurnInput): number {
  const bytes =
    Buffer.byteLength(careerInstructionsForRole(input.activeRole, input.internalPurpose), 'utf8') +
    Buffer.byteLength(serializeCoachInput(input), 'utf8');
  return Math.ceil(bytes / 4);
}

type Step = (input: CoachTurnInput) => CoachTurnInput | null;

const withHistory = (
  input: CoachTurnInput,
  change: (
    history: NonNullable<NonNullable<CoachTurnInput['knowledgeContext']>['consultantHistory']>,
  ) => NonNullable<NonNullable<CoachTurnInput['knowledgeContext']>['consultantHistory']> | null,
): CoachTurnInput | null => {
  const history = input.knowledgeContext?.consultantHistory;
  const next = history ? change(history) : null;
  return next && input.knowledgeContext
    ? { ...input, knowledgeContext: { ...input.knowledgeContext, consultantHistory: next } }
    : null;
};

const dropPastMatches: Step = (input) =>
  withHistory(input, (history) =>
    history.messageSnippets.length ? { ...history, messageSnippets: [] } : null,
  );

const dropOldestMessage =
  (keep: number): Step =>
  (input) =>
    input.messages.length > keep ? { ...input, messages: input.messages.slice(1) } : null;

const dropLastMarket =
  (keep: number): Step =>
  (input) => {
    const market = input.marketObservations ?? [];
    return market.length > keep ? { ...input, marketObservations: market.slice(0, -1) } : null;
  };

const shortenDocuments: Step = (input) => {
  const knowledge = input.knowledgeContext;
  if (!knowledge?.documents.some((document) => document.excerpt.length > DOCUMENT_EXCERPT_CHARS))
    return null;
  const documents = knowledge.documents.map((document) => ({
    ...document,
    excerpt: document.excerpt.slice(0, DOCUMENT_EXCERPT_CHARS),
  }));
  return { ...input, knowledgeContext: { ...knowledge, documents } };
};

const dropOldestSummary =
  (keep: number): Step =>
  (input) =>
    withHistory(input, (history) =>
      history.summaries.length > keep
        ? { ...history, summaries: history.summaries.slice(0, -1) }
        : null,
    );

/**
 * Порядок урезания: сначала хвост хода — найденные прошлые реплики, лишний
 * рынок, старые реплики, — потом выдержки документов и старые сводки.
 * Факты профиля не трогаем: это доказательная база ответа. Урезание хвоста
 * не меняет постоянный префикс, и кэш провайдера продолжает работать.
 */
const STEPS: readonly Step[] = [
  dropPastMatches,
  dropLastMarket(8),
  dropOldestMessage(RECENT_MESSAGES),
  shortenDocuments,
  dropOldestSummary(MIN_SUMMARIES),
  dropOldestMessage(MIN_MESSAGES),
  dropLastMarket(MIN_MARKET),
  dropOldestSummary(0),
];

export function fitCoachTurnInput(
  input: CoachTurnInput,
  tokenLimit = COACH_TURN_INPUT_TOKEN_LIMIT,
): CoachTurnInput {
  // Структурный шаг (проверка навыков, сводка беседы) работает со всем контекстом.
  if (input.internalPurpose) return input;
  let current = input;
  for (const step of STEPS) {
    while (estimateCoachTurnTokens(current) > tokenLimit) {
      const next = step(current);
      if (!next) break;
      current = next;
    }
  }
  return current;
}
