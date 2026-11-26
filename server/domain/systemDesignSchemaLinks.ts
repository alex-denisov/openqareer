/**
 * B647: связи схемы внутри одного предложения ответа. Порядок правил:
 * стрелки → глаголы записи/чтения → «из X в Y» → компоненты подряд, если в
 * предложении есть глагол потока. Ничего не нашлось — связей нет.
 */
import type { SchemaMention } from './systemDesignSchema';

export interface SentenceLink {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

type Direction = 'forward' | 'reverse';

/** Глагол записи: подлежащее → цель. Глагол чтения: источник → подлежащее. */
const VERBS: ReadonlyArray<readonly [string, Direction]> = [
  ...[
    'пишет',
    'записыва',
    'отправля',
    'шлёт',
    'шлет',
    'кладёт',
    'кладет',
    'публику',
    'передаёт',
    'передает',
    'вызыва',
    'обраща',
    'sends',
    'writes',
    'pushes',
    'publishes',
    'calls',
    'puts',
  ].map((stem) => [stem, 'forward'] as const),
  ...[
    'читает',
    'читают',
    'забира',
    'получает',
    'берёт',
    'берет',
    'слушает',
    'reads',
    'consumes',
    'pulls',
    'fetches',
  ].map((stem) => [stem, 'reverse'] as const),
];
const FLOW_CUES = [
  'проходит',
  'идёт',
  'идет',
  'идут',
  'поступает',
  'попадает',
  'затем',
  'потом',
  'дальше',
  'flows',
  'goes',
  'then',
];
const ARROW = /\s*(?:→|->|=>|⟶)\s*/u;

interface VerbHit {
  readonly stem: string;
  readonly direction: Direction;
  readonly at: number;
}

function verbHits(lower: string): VerbHit[] {
  return VERBS.flatMap(([stem, direction]) => {
    const hits: VerbHit[] = [];
    for (let at = lower.indexOf(stem); at >= 0; at = lower.indexOf(stem, at + 1)) {
      hits.push({ stem, direction, at });
    }
    return hits;
  }).sort((a, b) => a.at - b.at);
}

function arrowLinks(sentence: string, mentions: readonly SchemaMention[]): SentenceLink[] {
  const parts = sentence.split(ARROW);
  if (parts.length < 2) return [];
  let offset = 0;
  const spans = parts.map((part) => {
    const start = sentence.indexOf(part, offset);
    offset = start + part.length;
    return mentions.filter((mention) => mention.start >= start && mention.start < offset);
  });
  return spans.slice(1).flatMap((right, index) => {
    const from = spans[index]!.at(-1);
    const to = right[0];
    return from && to ? [{ from: from.id, to: to.id }] : [];
  });
}

function verbLinks(lower: string, mentions: readonly SchemaMention[]): SentenceLink[] {
  let subject: SchemaMention | undefined;
  let objectEnd = 0;
  return verbHits(lower).flatMap((verb) => {
    const before = mentions.filter(
      (mention) => mention.start >= objectEnd && mention.end <= verb.at,
    );
    subject = before.at(-1) ?? subject;
    const target = mentions.find((mention) => mention.start > verb.at);
    if (!subject || !target) return [];
    objectEnd = target.end;
    const [from, to] = verb.direction === 'forward' ? [subject, target] : [target, subject];
    return [{ from: from.id, to: to.id, label: verb.stem }];
  });
}

function fromToLinks(lower: string, mentions: readonly SchemaMention[]): SentenceLink[] {
  const source = /(?<![\p{L}])из\s/u.exec(lower);
  if (!source) return [];
  const target = /\sв[о]?\s/u.exec(lower.slice(source.index + 3));
  if (!target) return [];
  const targetAt = source.index + 3 + target.index;
  const from = mentions.find((mention) => mention.start > source.index && mention.start < targetAt);
  const to = mentions.find((mention) => mention.start > targetAt);
  return from && to ? [{ from: from.id, to: to.id }] : [];
}

function sequentialLinks(lower: string, mentions: readonly SchemaMention[]): SentenceLink[] {
  if (!FLOW_CUES.some((flowCue) => lower.includes(flowCue))) return [];
  return mentions.slice(1).map((mention, index) => ({ from: mentions[index]!.id, to: mention.id }));
}

export function linksOfSentence(
  sentence: string,
  mentions: readonly SchemaMention[],
): SentenceLink[] {
  if (mentions.length < 2) return [];
  const lower = sentence.toLocaleLowerCase('ru-RU');
  for (const rule of [
    () => arrowLinks(sentence, mentions),
    () => verbLinks(lower, mentions),
    () => fromToLinks(lower, mentions),
    () => sequentialLinks(lower, mentions),
  ]) {
    const links = rule();
    if (links.length > 0) return links;
  }
  return [];
}
